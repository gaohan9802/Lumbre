export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import {
  getBook, getChapter, getAnnotations, getChatHistory,
  addChatMessage, updateProgress, buildSystemPrompt, extractAnnotations,
} from '@/server/coread-store'
import { streamLLM, LLMProfile } from '@/server/coread-llm'
import { ensureDigest } from '@/server/coread-digest'

// GET /api/coread/chat?bookId=xxx[&cnum=n] — get chat history
export async function GET(req: NextRequest) {
  const bookId = req.nextUrl.searchParams.get('bookId')
  const cnumRaw = req.nextUrl.searchParams.get('cnum')
  if (!bookId) return NextResponse.json({ error: 'missing bookId' }, { status: 400 })
  try {
    const cnum = cnumRaw != null ? parseInt(cnumRaw, 10) : undefined
    const items = getChatHistory(bookId, 40, Number.isFinite(cnum as number) ? cnum : undefined)
    return NextResponse.json({ items })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

/**
 * Resolve the LLM profile: prefer the client's active API profile (unified with
 * the 星星 module), fall back to env vars for backward compatibility.
 */
function resolveProfile(apiProfile: any): LLMProfile | null {
  if (apiProfile?.apiKey) {
    return {
      provider: apiProfile.provider === 'anthropic' ? 'anthropic' : 'openai-compatible',
      baseUrl: apiProfile.baseUrl || '',
      apiKey: apiProfile.apiKey,
      model: apiProfile.modelId || apiProfile.model || 'claude-sonnet-4-20250514',
    }
  }
  const baseUrl = process.env.LLM_BASE_URL || process.env.COREAD_LLM_BASE_URL || ''
  const apiKey = process.env.LLM_API_KEY || process.env.COREAD_LLM_API_KEY || ''
  const model = process.env.LLM_MODEL || process.env.COREAD_LLM_MODEL || 'deepseek-chat'
  if (!baseUrl || !apiKey) return null
  return { provider: 'openai-compatible', baseUrl, apiKey, model }
}

// POST /api/coread/chat — send a message (SSE streaming)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { bookId, chapterNum, message, selection, ann, api_profile } = body

    if (!bookId || !message?.trim()) {
      return NextResponse.json({ error: '缺少 bookId 或 message' }, { status: 400 })
    }

    const cnum = parseInt(chapterNum, 10) || 0
    const bookData = getBook(bookId)
    if (!bookData) return NextResponse.json({ error: '没这本书' }, { status: 404 })

    const profile = resolveProfile(api_profile)
    if (!profile) {
      return NextResponse.json({ error: '模型未配置（请在星星里选好模型和 API，共读会复用同一套）' }, { status: 500 })
    }

    const chapter = getChapter(bookId, cnum)
    const annotations = getAnnotations(bookId, cnum)

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

    // Channel isolation: only this chapter's prior discussion feeds the model.
    const history = getChatHistory(bookId, 24, cnum)
    const messages = [
      ...history.map(c => ({ role: (c.who === 'user' ? 'user' : 'assistant') as 'user' | 'assistant', content: c.text })),
      { role: 'user' as const, content: message.slice(0, 4000) },
    ]

    // Persist user message before generation so failures don't lose it.
    addChatMessage(bookId, cnum, 'user', message.slice(0, 4000))
    updateProgress(bookId, cnum)

    // Backfill this chapter's digest (deduped, non-blocking).
    if (chapter && !chapter.digest) void ensureDigest(profile, bookId, cnum)

    const encoder = new TextEncoder()
    const chContent = chapter?.content || ''

    const readable = new ReadableStream({
      async start(controller) {
        const hb = setInterval(() => {
          try { controller.enqueue(encoder.encode(': hb\n\n')) } catch {}
        }, 15000)

        let fullReply = ''
        try {
          fullReply = await streamLLM(
            profile,
            messages,
            systemPrompt,
            (delta) => {
              fullReply += delta
              try {
                controller.enqueue(encoder.encode(`event: live\ndata: ${JSON.stringify({ t: fullReply })}\n\n`))
              } catch {}
            },
            { maxTokens: 2048, temperature: 0.8 },
          )

          const ex = extractAnnotations(fullReply, bookId, cnum, chContent)
          fullReply = ex.text
          if (fullReply) addChatMessage(bookId, cnum, 'ai', fullReply)

          controller.enqueue(encoder.encode(
            `event: final\ndata: ${JSON.stringify({ reply: fullReply || '（没接住，再说一遍？）', ann: ex.count })}\n\n`
          ))
        } catch (e: any) {
          controller.enqueue(encoder.encode(
            `event: final\ndata: ${JSON.stringify({ error: '（没接住：' + (e?.message || e) + '）' })}\n\n`
          ))
        }

        clearInterval(hb)
        controller.close()
      },
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
