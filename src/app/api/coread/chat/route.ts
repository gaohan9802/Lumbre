export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import {
  getBook, getChapter, getAnnotations, getChatHistory,
  addChatMessage, updateProgress, buildSystemPrompt,
  extractAnnotations, setDigest, getDigest
} from '@/server/coread-store'

// GET /api/coread/chat?bookId=xxx — get chat history
export async function GET(req: NextRequest) {
  const bookId = req.nextUrl.searchParams.get('bookId')
  if (!bookId) return NextResponse.json({ error: 'missing bookId' }, { status: 400 })
  try {
    const items = getChatHistory(bookId, 40)
    return NextResponse.json({ items })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/coread/chat — send a message (SSE streaming)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { bookId, chapterNum, message, selection, ann } = body

    if (!bookId || !message?.trim()) {
      return NextResponse.json({ error: '缺少 bookId 或 message' }, { status: 400 })
    }

    const cnum = parseInt(chapterNum, 10) || 0
    const bookData = getBook(bookId)
    if (!bookData) return NextResponse.json({ error: '没这本书' }, { status: 404 })

    const chapter = getChapter(bookId, cnum)
    const annotations = getAnnotations(bookId, cnum)

    // Build system prompt (coread-style)
    const systemPrompt = buildSystemPrompt({
      bookId,
      bookTitle: bookData.book.title,
      bookAuthor: bookData.book.author,
      chapterNum: cnum,
      chapterTitle: chapter?.title || '',
      chapterContent: chapter?.content || '',
      selection: selection?.slice(0, 500),
      annRef: ann,
      annotations,
    })

    // Build message history from stored chats
    const history = getChatHistory(bookId, 24)
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map(c => ({
        role: c.who === 'user' ? 'user' : 'assistant',
        content: c.text
      })),
      { role: 'user', content: message.slice(0, 4000) }
    ]

    // Save user message first (before generation — survive failures)
    addChatMessage(bookId, cnum, 'user', message.slice(0, 4000))
    updateProgress(bookId, cnum)

    // Trigger digest generation if needed (lazy, non-blocking)
    if (chapter && !chapter.digest && chapter.content.length >= 200) {
      triggerDigest(bookId, cnum, chapter.content)
    }

    // Call LLM via SSE
    const llmBaseUrl = process.env.LLM_BASE_URL || process.env.COREAD_LLM_BASE_URL || ''
    const llmApiKey = process.env.LLM_API_KEY || process.env.COREAD_LLM_API_KEY || ''
    const llmModel = process.env.LLM_MODEL || process.env.COREAD_LLM_MODEL || 'deepseek-chat'

    if (!llmBaseUrl || !llmApiKey) {
      return NextResponse.json({ error: 'LLM 未配置 (需要 LLM_BASE_URL + LLM_API_KEY)' }, { status: 500 })
    }

    const url = llmBaseUrl.replace(/\/$/, '') + '/chat/completions'
    const llmRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${llmApiKey}`,
      },
      body: JSON.stringify({
        model: llmModel,
        messages,
        stream: true,
        temperature: 0.8,
      }),
    })

    if (!llmRes.ok) {
      const errText = await llmRes.text()
      return NextResponse.json({ error: `LLM ${llmRes.status}: ${errText.slice(0, 200)}` }, { status: 502 })
    }

    // Stream response as SSE to client
    const encoder = new TextEncoder()
    const reader = llmRes.body!.getReader()
    const decoder = new TextDecoder()

    let fullReply = ''
    let sseBuffer = ''

    const readable = new ReadableStream({
      async start(controller) {
        const hb = setInterval(() => {
          try { controller.enqueue(encoder.encode(': hb\n\n')) } catch {}
        }, 15000)

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            sseBuffer += decoder.decode(value, { stream: true })

            const lines = sseBuffer.split('\n')
            sseBuffer = lines.pop() || ''

            for (const line of lines) {
              if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
              try {
                const chunk = JSON.parse(line.slice(6))
                const delta = chunk.choices?.[0]?.delta?.content
                if (delta) {
                  fullReply += delta
                  controller.enqueue(encoder.encode(`event: live\ndata: ${JSON.stringify({ t: fullReply })}\n\n`))
                }
              } catch { /* skip partial frames */ }
            }
          }

          // Process annotations from final reply
          const chContent = chapter?.content || ''
          const ex = extractAnnotations(fullReply, bookId, cnum, chContent)
          fullReply = ex.text

          // Save AI reply
          if (fullReply) {
            addChatMessage(bookId, cnum, 'ai', fullReply)
          }

          controller.enqueue(encoder.encode(
            `event: final\ndata: ${JSON.stringify({ reply: fullReply || '（没接住，再说一遍？）', ann: ex.count })}\n\n`
          ))
        } catch (e: any) {
          controller.enqueue(encoder.encode(
            `event: final\ndata: ${JSON.stringify({ error: '（没接住：' + e.message + '）' })}\n\n`
          ))
        }

        clearInterval(hb)
        controller.close()
      }
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Lazy digest generation (non-blocking)
function triggerDigest(bookId: string, chapterNum: number, content: string) {
  const llmBaseUrl = process.env.LLM_BASE_URL || process.env.COREAD_LLM_BASE_URL || ''
  const llmApiKey = process.env.LLM_API_KEY || process.env.COREAD_LLM_API_KEY || ''
  const digestModel = process.env.DIGEST_MODEL || process.env.LLM_MODEL || process.env.COREAD_LLM_MODEL || 'deepseek-chat'

  if (!llmBaseUrl || !llmApiKey) return

  const raw = content.replace(/\s+/g, ' ').slice(0, 7000)
  const url = llmBaseUrl.replace(/\/$/, '') + '/chat/completions'

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${llmApiKey}`,
    },
    body: JSON.stringify({
      model: digestModel,
      messages: [{ role: 'user', content: '下面是一本书某一章的原文。写一段不超过120字的情节脉络摘要（发生了什么、出场人物、关键转折），纯叙述、无标题无列表无markdown，直接输出正文：\n\n' + raw }],
      max_tokens: 220,
      temperature: 0.3,
    }),
  }).then(async (res) => {
    if (!res.ok) return
    const data = await res.json()
    const digest = data.choices?.[0]?.message?.content?.trim()
    if (digest && digest.length > 10) {
      setDigest(bookId, chapterNum, digest)
    }
  }).catch(() => { /* silent fail — next time it'll retry */ })
}
