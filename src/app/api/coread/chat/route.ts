export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import {
  getBook, getChapter, getAnnotations, getChatHistory,
  addChatMessage, updateProgress, buildReadingContext, extractAnnotations,
} from '@/server/coread-store'
import { LLMProfile } from '@/server/coread-llm'
import { ensureDigest } from '@/server/coread-digest'
import { appendCoreadChatMessage } from '@/server/chat-sync'

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
 * Resolve a plain LLMProfile for digest generation (non-tool, non-stream).
 * Prefers the client's active API profile, falls back to env vars.
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

/**
 * POST /api/coread/chat — send a message (SSE streaming).
 *
 * 方案B：共读不再用独立的裸 LLM，而是转发到星星的主管道 /api/chat。
 * 这样陪读的就是星星本人——带着全部记忆(breath/hold)、日记、纸条等工具。
 * 读书上下文（正在读的原文、故事弧、防剧透、批注规则）通过 bookmark_injections
 * 注入到星星的系统提示之后；星星的人格与工具由 /api/chat 提供。
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { bookId, chapterNum, message, selection, ann, api_profile, system, thinking_budget, temperature, prompt_caching } = body

    if (!bookId || !message?.trim()) {
      return NextResponse.json({ error: '缺少 bookId 或 message' }, { status: 400 })
    }

    const cnum = parseInt(chapterNum, 10) || 0
    const bookData = getBook(bookId)
    if (!bookData) return NextResponse.json({ error: '没这本书' }, { status: 404 })

    if (!api_profile?.apiKey) {
      return NextResponse.json({ error: '模型未配置（请在星星里选好模型和 API，共读会复用同一套）' }, { status: 500 })
    }

    const chapter = getChapter(bookId, cnum)
    const annotations = getAnnotations(bookId, cnum)

    const readingContext = buildReadingContext({
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
    appendCoreadChatMessage({ bookId, bookTitle: bookData.book.title, role: 'user', content: message.slice(0, 4000), chapterNum: cnum })
    updateProgress(bookId, cnum)

    // Backfill this chapter's digest (deduped, non-blocking).
    const digestProfile = resolveProfile(api_profile)
    if (digestProfile && chapter && !chapter.digest) void ensureDigest(digestProfile, bookId, cnum)

    // Forward to the 星星 pipeline on the same host.
    const host = req.headers.get('host')
    const proto = req.headers.get('x-forwarded-proto') || 'https'
    const origin = host ? `${proto}://${host}` : ''

    const upstream = await fetch(`${origin}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        api_profile,
        stream: true,
        tools_enabled: true,
        system,
        thinking_budget,
        temperature,
        prompt_caching,
        bookmark_injections: readingContext,
      }),
    })

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => '')
      return NextResponse.json({ error: `星星管道错误 ${upstream.status}: ${errText.slice(0, 300)}` }, { status: 500 })
    }

    const encoder = new TextEncoder()
    const chContent = chapter?.content || ''

    const readable = new ReadableStream({
      async start(controller) {
        const hb = setInterval(() => {
          try { controller.enqueue(encoder.encode(': hb\n\n')) } catch {}
        }, 15000)

        const reader = upstream.body!.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let fullReply = ''
        let doneEmitted = false

        const emitLive = () => {
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ t: fullReply })}\n\n`))
          } catch {}
        }
        const finalize = (errMsg?: string) => {
          if (doneEmitted) return
          doneEmitted = true
          if (errMsg) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: '（没接住：' + errMsg + '）' })}\n\n`))
            return
          }
          const ex = extractAnnotations(fullReply, bookId, cnum, chContent)
          fullReply = ex.text
          if (fullReply) {
            addChatMessage(bookId, cnum, 'ai', fullReply)
            appendCoreadChatMessage({ bookId, bookTitle: bookData.book.title, role: 'assistant', content: fullReply, chapterNum: cnum, modelId: api_profile?.modelId })
          }
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ reply: fullReply || '（没接住，再说一遍？）', ann: ex.count })}\n\n`
          ))
        }

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            const lines = buf.split('\n')
            buf = lines.pop() || ''
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const payload = line.slice(6)
              if (payload === '[DONE]') continue
              try {
                const evt = JSON.parse(payload)
                if (evt.type === 'text' && evt.content) {
                  fullReply += evt.content
                  emitLive()
                } else if (evt.type === 'error') {
                  finalize(evt.content || '上游错误')
                }
                // thinking / tool_call events are intentionally not surfaced to
                // the reading UI — 星星 uses memory silently while reading.
              } catch {}
            }
          }
          finalize()
        } catch (e: any) {
          finalize(e?.message || String(e))
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
