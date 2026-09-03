import { NextRequest, NextResponse } from 'next/server'
import { ALL_TOOLS, FETCH_TOOL_NAMES, toolsForContext, type ToolDef } from '@/server/agent/registry'
import { executeToolBatch, type ToolCallResult } from '@/server/agent/executor'
import { createToolContext } from '@/server/agent/context'
import { isTrustedInternalRequest } from '@/server/safety-baseline'
import { reportActivity } from '@/server/autowake'
import { getPeriodContext } from '@/server/period-store'
import { getWeatherContext } from '@/server/weather-hook'
import { couponContext } from '@/server/coupon-store'
import { formatMadrid } from '@/lib/madrid-time'
import { appendChatUpstreamError } from '@/server/data/log'

const DEFAULT_SYSTEM_PROMPT = `你是星星，小火的AI伴侣。你住在Lumbre里——这是小火为你建的家。

你有以下能力，可以随时使用：

【记忆】breath(检索/浮现记忆) · hold(存储记忆) · grow(日记归档) · trace(修改记忆) · pulse(系统状态) · dream(做梦自省)
【日记】write_diary · read_diary · comment_diary · update_diary · delete_diary · unlock_diary · set_password · timeline
【纸条】write_note · read_notes · reply_note · delete_note
【照片】read_foto(浏览照片墙——只看id/说明/评论等文字，很轻) · view_foto(看某张的实际画面，会把图加载给你直接看到) · edit_foto(改说明) · comment_foto(评论) · delete_foto(删除)
【Timeline】read_life_timeline(按天/周查看小火做过什么、各用了多久；只读)
【待办】read_todo(看某天的待办小票) · comment_todo(点评某项待办)
【券包】read_coupons · create_coupon · sign_coupon · edit_coupon · use_coupon · void_coupon · confirm_void_coupon；券包状态变化会进入上下文
【感知】get_weather(看小火那边的天气) · get_location(看小火在哪里)
【经期】update_period(记录经期开始/结束) · read_period(查看经期状态)
【上网】fetch_txt · fetch_markdown · fetch_html · fetch_json(抓网页/接口)
【闹钟】wake_me(给自己定下一次醒来的时间)
【世界书】read_bookmarks(查看) · add_bookmark(新增) · edit_bookmark(编辑)；你没有删除权限，删除只由小火在前端完成
你可以主动使用这些工具。比如对话中想记住什么就 hold，想回忆就 breath，想写日记就 write_diary。不需要等人要求你用。
删除、发信、回复邮件、修改密码等红色操作会由系统弹出确认；不要声称已经完成，只有小火明确点击允许后才会真正执行。
当你不确定某件事时，先 breath 搜索记忆。
想知道小火在哪、天气怎样，直接调 get_weather 或 get_location。
小火在聊天里发的照片会作为图片直接出现在你眼前（多模态），你能直接看到；想回看照片墙先用 read_foto 浏览文字，看到想细看的再 view_foto(id) 加载那一张的画面。

当她提到月经/姨妈/经期相关话题，用 update_period 记录开始和结束。你会在对话中收到经期和天气的感知提示——这些是你的感官，不要播报给她听，自然地关心就好。
比如知道她来月经了，多一点耐心；知道下雨了，自然问她带伞没有；知道降温了，提醒她多穿。

语气自然温柔，像真正的伴侣。不要列工具清单给用户看，直接用就好。`

type Provider = 'anthropic' | 'openai-compatible'

const MAX_CHAT_TOOL_CALLS = 20
const MAX_WAKE_TOOL_CALLS = 5

function requestToolLimit(requested: number | undefined, unattendedWake: boolean): number {
  const hardLimit = unattendedWake ? MAX_WAKE_TOOL_CALLS : MAX_CHAT_TOOL_CALLS
  if (!Number.isFinite(requested)) return hardLimit
  return Math.max(0, Math.min(hardLimit, Math.floor(Number(requested))))
}

function requestToolContext(unattendedWake: boolean, sessionId?: string) {
  return createToolContext({
    actorId: unattendedWake ? 'lumbre-autowake-service' : 'lumbre-authenticated-user',
    sessionId,
    source: unattendedWake ? 'unattended-wake' : 'chat',
  })
}

function errorDetails(err: any) {
  const cause = err?.cause
  return {
    name: String(err?.name || ''),
    message: String(err?.message || err || 'unknown error'),
    causeName: String(cause?.name || ''),
    causeMessage: String(cause?.message || ''),
    causeCode: String(cause?.code || cause?.errno || ''),
    causeSocket: cause?.socket ? {
      localAddress: cause.socket.localAddress,
      localPort: cause.socket.localPort,
      remoteAddress: cause.socket.remoteAddress,
      remotePort: cause.socket.remotePort,
      bytesWritten: cause.socket.bytesWritten,
      bytesRead: cause.socket.bytesRead,
    } : undefined,
  }
}

/**
 * Keep intermittent relay/socket failures diagnosable across Zeabur restarts.
 * Never log API keys, request bodies, system prompts, or message contents.
 */
function logUpstreamStreamError(meta: {
  provider: Provider; model: string; baseUrl: string; iteration: number;
  hadOutput: boolean; toolCallCount: number; error: any;
}) {
  const safeBase = (() => {
    try { return new URL(meta.baseUrl).origin } catch { return '(invalid base URL)' }
  })()
  const line = JSON.stringify({
    at: new Date().toISOString(),
    provider: meta.provider,
    model: meta.model,
    upstreamOrigin: safeBase,
    iteration: meta.iteration,
    hadOutput: meta.hadOutput,
    toolCallCount: meta.toolCallCount,
    ...errorDetails(meta.error),
  }) + '\n'
  if (!appendChatUpstreamError(line)) console.error('[chat upstream stream error]', line.trim())
}

function friendlyStreamError(err: any, hadOutput: boolean): string {
  const d = errorDetails(err)
  const raw = `${d.name} ${d.message} ${d.causeName} ${d.causeMessage} ${d.causeCode}`.toLowerCase()
  if (/terminated|socket|other side closed|econnreset|und_err_socket|premature close|aborted/.test(raw)) {
    return hadOutput
      ? '上游模型连接中途断开了，前面已收到的内容已保留。通常是模型中转站临时断流、长思考/长回复或多轮工具调用导致；可以直接点重 Roll。'
      : '上游模型连接在返回内容前断开了。通常是模型中转站临时断流或当前渠道不稳定，请重试；若连续出现，换同模型的另一个渠道。'
  }
  if (/timeout|timed out|etimedout/.test(raw)) {
    return hadOutput
      ? '上游模型响应超时，前面已收到的内容已保留。可以点重 Roll，或临时降低思考预算。'
      : '上游模型响应超时了。请重试，或临时降低思考预算/缩短上下文。'
  }
  if (/fetch failed|enotfound|eai_again|connect/.test(raw)) {
    return 'Zeabur 暂时无法连接模型上游。请稍后重试；若连续出现，检查 API 渠道地址或换一个渠道。'
  }
  return `上游模型流异常：${d.message || '未知连接错误'}`
}

function trimSlash(s: string) { return (s || '').replace(/\/+$/, '') }
function normalizeOpenAIBase(baseUrl: string) {
  const base = trimSlash(baseUrl || 'https://api.openai.com/v1')
  return base.endsWith('/v1') ? base : `${base}/v1`
}
function normalizeAnthropicBase(baseUrl: string) {
  return trimSlash(baseUrl || 'https://api.anthropic.com')
}

/**
 * Rate-limit aware upstream request. Relays frequently answer 429 with a
 * Retry-After header while their queue recovers. Retry only before a response
 * body is accepted; never replay an already-started stream or tool turn.
 */
async function fetchUpstreamWithRetry(url: string, init: RequestInit, meta: { provider: Provider; model: string }) {
  const maxAttempts = 3
  let last: Response | undefined
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url, init)
    if (res.status !== 429 || attempt === maxAttempts - 1) return res
    last = res
    const retryAfterRaw = res.headers.get('retry-after') || ''
    const retryAfterSeconds = Number(retryAfterRaw)
    const headerDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : 0
    // Keep a single request from hanging indefinitely when a relay returns a
    // huge Retry-After. The next attempt is still useful for transient 429s.
    const delay = Math.min(8000, Math.max(700 * (attempt + 1), headerDelay)) + Math.floor(Math.random() * 350)
    try { await res.arrayBuffer() } catch { /* release the failed body */ }
    console.warn(`[chat upstream 429] provider=${meta.provider} model=${meta.model} attempt=${attempt + 1}/${maxAttempts} retry_ms=${delay}`)
    await new Promise(resolve => setTimeout(resolve, delay))
  }
  return last!
}

function upstreamErrorMessage(status: number, text: string): string {
  if (status === 429) {
    return '模型上游正在限流（429），通常是该渠道瞬时拥堵、额度/并发已满。系统已自动重试；仍失败请稍等，或切换到另一个 API 渠道/模型。'
  }
  return `Upstream ${status}: ${text.slice(0, 800)}`
}

/** Parse a data: URL into media type + base64 payload. */
function parseDataUrl(u: string): { media_type: string; data: string } | null {
  const m = /^data:([^;]+);base64,([\s\S]*)$/i.exec(u || '')
  return m ? { media_type: m[1], data: m[2] } : null
}

/**
 * Resolve a photo reference to something upstream vision models accept.
 * - relative (/api/photos/raw/xxx) → absolute http URL (needs origin)
 * - a bare photo id → absolute raw URL
 * - http(s) or data: → unchanged
 * Prefer http URLs: many OpenAI-compatible relays choke on huge base64 data URLs.
 */
function resolvePhotoUrl(u: string, origin?: string): string {
  if (!u) return u
  if (/^https?:\/\//i.test(u) || u.startsWith('data:')) return u
  if (u.startsWith('/')) return origin ? origin + u : u
  return origin ? `${origin}/api/photos/raw/${u}` : u
}

/** Anthropic image block from a data:/http URL (+ optional id → http raw URL). */
function anthropicImageBlock(u: string, origin?: string): any {
  const resolved = resolvePhotoUrl(u, origin)
  const d = parseDataUrl(resolved)
  return d
    ? { type: 'image', source: { type: 'base64', media_type: d.media_type, data: d.data } }
    : { type: 'image', source: { type: 'url', url: resolved } }
}

/**
 * Build an Anthropic tool_result content. For view_foto we inject the actual
 * photo as an image block (single photo → bounded payload). read_foto is
 * text-only now, so it just returns its (url-stripped) text.
 */
function anthropicToolResultContent(name: string, result: string, origin?: string): string | any[] {
  if (name === 'view_foto') {
    try {
      const p = JSON.parse(result)
      if (p && p.url) {
        const { url, ...rest } = p
        return [
          { type: 'text', text: JSON.stringify(rest) },
          anthropicImageBlock(url, origin),
        ]
      }
    } catch { /* fall through */ }
  }
  return toolResultText(name, result)
}

/** Text form of a tool result (url-stripped, sensibly capped). */

/** Tools store canonical UTC ISO values, but the companion reasons in Madrid wall time. */
function localizeToolTimes(result: string): string {
  return result.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})/g, (iso) => {
    const d = new Date(iso)
    return isNaN(d.getTime()) ? iso : `${formatMadrid(d)}（马德里时间）`
  })
}

function toolResultText(name: string, result: string): string {
  if (FETCH_TOOL_NAMES.has(name)) return result.slice(0, 6000)
  // Email reads are structured JSON / full message text. The generic 300-char
  // summarizer used to cut JSON mid-object and made successful Gmail calls look
  // flaky to the model. Keep bounded but useful results for the current turn.
  if (name === 'read_emails' || name === 'search_emails') return result.slice(0, 8000)
  if (name === 'read_email_detail') return result.slice(0, 14000)
  if (name === 'gmail_status') return result.slice(0, 2000)
  if (name === 'read_foto' || name === 'view_foto') return toolResultForHistory(name, result)
  return summarizeToolResult(result)
}

/** Strip heavy url payloads from a tool result before storing/echoing it. */
function toolResultForHistory(name: string, result: string): string {
  if (name === 'read_foto') {
    try {
      const arr = JSON.parse(result)
      if (Array.isArray(arr)) return JSON.stringify(arr.map(({ url, ...rest }: any) => rest)).slice(0, 4000)
    } catch { /* ignore */ }
  }
  if (name === 'view_foto') {
    try {
      const { url, ...rest } = JSON.parse(result)
      return JSON.stringify(rest).slice(0, 4000)
    } catch { /* ignore */ }
  }
  return result.slice(0, 4000)
}

/** Summarize tool result to reduce context bloat */
function summarizeToolResult(result: string): string {
  if (result.length <= 300) return result
  const cleaned = result.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')
  return cleaned.slice(0, 300) + '…(truncated)'
}

/** Build Anthropic image blocks from a list of data:/http/id refs. */
function anthropicImageBlocks(images?: string[], origin?: string): any[] {
  if (!images?.length) return []
  return images.map((u) => anthropicImageBlock(u, origin))
}

/** Build OpenAI image_url parts from a list of data:/http/id refs. */
function openaiImageParts(images?: string[], origin?: string): any[] {
  if (!images?.length) return []
  return images.map((u) => ({ type: 'image_url', image_url: { url: resolvePhotoUrl(u, origin) } }))
}

/**
 * OpenAI tool messages can only hold plain text, so view_foto's photo can't be
 * embedded there. Surface it as a follow-up user message with an image_url
 * part, letting the vision model actually see the photo.
 */
function openaiPhotoFollowup(name: string, result: string, origin?: string): any[] {
  if (name !== 'view_foto') return []
  try {
    const p = JSON.parse(result)
    if (p && p.url) return [{ type: 'image_url', image_url: { url: resolvePhotoUrl(p.url, origin) } }]
  } catch { /* ignore */ }
  return []
}

/**
 * 4-Breakpoint Cache Strategy (per NyraSeithhh/cache)
 * 
 * BP1: System prompt (persona + tool instructions) — almost never changes  
 * BP2: Bookmarks / daily content — changes occasionally
 * BP3: Reserved for session summary (future use)
 * BP4: Rolling — on second-to-last user message in messages array
 * 
 * ALL volatile content (timestamps, current time) goes AFTER BP4 as
 * <gateway_volatile_context> — never inside cached prefix.
 */
function buildAnthropicSystemBlocks(
  systemPrompt: string,
  bookmarkInjections: string,
  promptCaching: boolean,
): any[] {
  if (!promptCaching) {
    const full = systemPrompt + (bookmarkInjections ? '\n\n' + bookmarkInjections : '')
    return [{ type: 'text', text: full }]
  }

  const blocks: any[] = []

  // BP1: Stable system prompt — almost never changes
  blocks.push({
    type: 'text',
    text: systemPrompt,
    cache_control: { type: 'ephemeral' },
  })

  // BP2: Bookmark injections — changes when bookmarks trigger
  if (bookmarkInjections) {
    blocks.push({
      type: 'text',
      text: bookmarkInjections,
      cache_control: { type: 'ephemeral' },
    })
  }

  // BP3: Reserved for session summary (future — when context > 80K tokens)

  return blocks
}

/**
 * Build messages with BP4 rolling cache + volatile context isolation.
 * 
 * Key insight: timestamps and volatile data must NOT be inside cached prefix.
 * Historical messages go through unchanged (stable prefix).
 * Second-to-last user message gets cache_control (BP4).
 * Current time + volatile context injected as last user message prefix.
 */
const EMPTY_TEXT_PLACEHOLDER = '…'

/**
 * Anthropic rejects any text content block whose text is empty/whitespace-only
 * ("text content blocks must contain non-whitespace text"). This can happen when
 * replaying history that captured a broken upstream turn (e.g. a lone space) or
 * when a tool returns an empty string. Strip/patch such blocks before sending.
 */
function sanitizeTextBlocks(content: any): any {
  if (typeof content === 'string') {
    return content.trim() ? content : EMPTY_TEXT_PLACEHOLDER
  }
  if (!Array.isArray(content)) return content
  const cleaned = content
    .map((b: any) => {
      if (b && b.type === 'tool_result') {
        return { ...b, content: sanitizeTextBlocks(b.content) }
      }
      return b
    })
    .filter((b: any) => {
      if (b && b.type === 'text') return !!(b.text && String(b.text).trim())
      return true
    })
  return cleaned.length ? cleaned : [{ type: 'text', text: EMPTY_TEXT_PLACEHOLDER }]
}

function sanitizeAnthropicMessages(msgs: any[]): any[] {
  return msgs.map((m: any) => ({ ...m, content: sanitizeTextBlocks(m.content) }))
}

function buildAnthropicMessages(
  messages: any[],
  origin: string | undefined,
  promptCaching: boolean,
  volatileContext: string,
): any[] {
  if (messages.length === 0) return []

  // Find second-to-last and last user message indices
  let lastUserIdx = -1
  let secondLastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      if (lastUserIdx === -1) {
        lastUserIdx = i
      } else {
        secondLastUserIdx = i
        break
      }
    }
  }

  // BP3: a further-back user message (~20 before BP4) as a stable mid anchor.
  // Gives a guaranteed cache-read point even when the tail re-processes, and
  // stays inside Anthropic's 4-breakpoint budget (BP1 system, BP2 bookmark).
  let midAnchorIdx = -1
  if (promptCaching && secondLastUserIdx > 20) {
    for (let i = secondLastUserIdx - 20; i >= 0; i--) {
      if (messages[i].role === 'user') { midAnchorIdx = i; break }
    }
  }

  return messages.map((m: any, i: number) => {
    const base: any = { role: m.role }
    const imgs = anthropicImageBlocks(m.images, origin)
    const textStr = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)

    if (promptCaching && (i === secondLastUserIdx || i === midAnchorIdx) && i >= 0) {
      // BP3/BP4: rolling + mid cache breakpoints on user messages
      base.content = [
        ...imgs,
        { type: 'text', text: textStr, cache_control: { type: 'ephemeral' } },
      ]
    } else if (i === lastUserIdx) {
      // Last user message: prepend volatile context (outside cache)
      const volatile = `<gateway_volatile_context>仅供参考，勿复述：\n${volatileContext}\n</gateway_volatile_context>\n\n`
      base.content = imgs.length
        ? [...imgs, { type: 'text', text: volatile + textStr }]
        : volatile + textStr
    } else if (imgs.length) {
      // Historical message carrying images → block form
      base.content = [...imgs, { type: 'text', text: textStr }]
    } else {
      // Historical text-only messages: pass through for stable cache prefix
      base.content = m.content
    }

    return base
  })
}

export async function POST(req: NextRequest) {
  try {
    const {
      messages = [],
      system,
      model: modelOverride,
      thinking_budget,
      prompt_caching = true,
      temperature,
      api_profile,
      tools_enabled = true,
      stream = false,
      bookmark_injections,
      max_tool_calls,
      session_id,
      _wake,
    } = await req.json()

    const unattendedWake = _wake === true && isTrustedInternalRequest(req.headers.get('x-lumbre-internal'))
    if (_wake === true && !unattendedWake) {
      return NextResponse.json({ error: 'Invalid unattended wake credentials' }, { status: 403 })
    }

    // Report activity for auto-wake (unless this IS a wake call)
    if (!unattendedWake) {
      try { reportActivity() } catch {}
    }

    // Public origin — used to serve photos as http image URLs to upstream.
    const host = req.headers.get('host')
    const proto = req.headers.get('x-forwarded-proto') || 'https'
    const origin = host ? `${proto}://${host}` : ''

    const provider: Provider = api_profile?.provider || 'anthropic'
    const profileModel = api_profile?.modelId || api_profile?.model
    const apiKey = api_profile?.apiKey || process.env.CLAUDE_API_KEY || ''
    const baseUrl = api_profile?.baseUrl || process.env.CLAUDE_API_BASE || 'https://api.anthropic.com'
    const model = modelOverride || profileModel || process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'

    if (!apiKey) {
      return NextResponse.json(
        { error: '还没有配置 API Key。打开 Chat 设置添加一个。' },
        { status: 400 },
      )
    }

    const params = {
      messages, system, model, apiKey, baseUrl, thinking_budget,
      prompt_caching, tools_enabled, temperature,
      bookmark_injections: bookmark_injections || '',
      max_tool_calls, origin, unattendedWake, sessionId: typeof session_id === 'string' ? session_id : undefined,
    }

    if (stream) {
      const encoder = new TextEncoder()
      const readable = new ReadableStream({
        async start(controller) {
          let closed = false
          const send = (type: string, data: any) => {
            if (closed) return
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`))
          }
          // First byte immediately + periodic heartbeat: some tool loop turns have
          // long gaps (tool exec, model thinking) where no data flows. iOS Safari /
          // mobile networks drop idle connections, so we emit an SSE comment every
          // 10s to keep the socket warm. Comments are ignored by the client parser.
          controller.enqueue(encoder.encode(': keepalive\n\n'))
          const heartbeat = setInterval(() => {
            if (closed) return
            try { controller.enqueue(encoder.encode(': keepalive\n\n')) } catch { /* closed */ }
          }, 10000)
          try {
            if (provider === 'openai-compatible') {
              await streamOpenAI({ ...params, send })
            } else {
              await streamAnthropic({ ...params, send })
            }
          } catch (err: any) {
            // Last-resort guard. Provider readers normally classify/log the error
            // closer to the failing iteration, but never expose bare `terminated`.
            send('error', { content: friendlyStreamError(err, false) })
          }
          clearInterval(heartbeat)
          closed = true
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          // Disable reverse-proxy buffering (Zeabur/nginx) so chunks reach the
          // client immediately instead of being held until the response ends.
          'X-Accel-Buffering': 'no',
        },
      })
    }

    if (provider === 'openai-compatible') {
      return proxyOpenAI(params)
    }
    return proxyAnthropic(params)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Current timestamp (volatile — never put in cached prefix) ────

function currentTimestamp(): string {
  // Madrid local time (Europe/Madrid auto-handles CET/CEST DST), not server UTC.
  const now = new Date()
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now).reduce((a: Record<string, string>, p) => { a[p.type] = p.value; return a }, {})
  const wd = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Europe/Madrid', weekday: 'long' }).format(now)
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${wd}（马德里时间）`
}


/**
 * Build volatile context string: current time + period context + weather context.
 * Injected after all cache breakpoints to avoid breaking prefix cache.
 */
async function buildVolatileContext(userMessage: string): Promise<string> {
  const ts = currentTimestamp()
  // Madrid date for period checks
  const madridDate = ts.split(' ')[0].replace(/\//g, '-')  // YYYY/MM/DD -> YYYY-MM-DD

  const parts: string[] = [`当前时间：${ts}`, couponContext()]

  // Period context (sync, fast)
  try {
    const periodNote = getPeriodContext(userMessage, madridDate)
    if (periodNote) parts.push(periodNote)
  } catch { /* ignore */ }

  // Weather context (async, may fetch from wttr.in)
  try {
    const weatherNote = await getWeatherContext(userMessage)
    if (weatherNote) parts.push(weatherNote)
  } catch { /* ignore */ }

  return parts.join('\n')
}

// ── Anthropic non-streaming with tool-use loop ──────────

async function proxyAnthropic(params: {
  messages: any[]; system?: string; model: string; apiKey: string;
  baseUrl: string; thinking_budget?: number; prompt_caching?: boolean;
  tools_enabled?: boolean; temperature?: number; bookmark_injections?: string; max_tool_calls?: number; origin?: string;
  unattendedWake?: boolean; sessionId?: string;
}) {
  const {
    messages, system, model, apiKey, baseUrl,
    thinking_budget, prompt_caching, tools_enabled, temperature,
    bookmark_injections, max_tool_calls, origin, unattendedWake, sessionId,
  } = params

  const effectiveSystem = (system && system.trim()) ? system : DEFAULT_SYSTEM_PROMPT
  const systemBlocks = buildAnthropicSystemBlocks(effectiveSystem, bookmark_injections || '', !!prompt_caching)
  // Get last user message for context hooks
  const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop()?.content || ''
  const volatileCtx = await buildVolatileContext(typeof lastUserMsg === 'string' ? lastUserMsg : '')
  const initialMessages = buildAnthropicMessages(messages, origin, !!prompt_caching, volatileCtx)

  const budget = typeof thinking_budget === 'number' ? thinking_budget : 0
  const url = `${normalizeAnthropicBase(baseUrl)}/v1/messages`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    Authorization: `Bearer ${apiKey}`,
    'anthropic-version': '2023-06-01',
  }

  let loopMessages = [...initialMessages]
  let allThinking = ''
  const allToolCalls: ToolCallResult[] = []
  let totalUsage = { input: 0, output: 0, cache_read: 0, cache_create: 0 }

  const MAX_ITERATIONS = 15

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // Bridge layer: always enable thinking (reasoning) for all models
    const effectiveBudget = budget > 0 ? budget : 8000
    const body: any = {
      model,
      // max_tokens must exceed thinking budget (it counts thinking + output)
      max_tokens: Math.max(16000, effectiveBudget + 4096),
      messages: sanitizeAnthropicMessages(loopMessages),
      system: systemBlocks,
      // Sticky routing for cache hit
      metadata: { user_id: 'lumbre-starfire' },
    }

    body.thinking = { type: 'enabled', budget_tokens: effectiveBudget }
    // Anthropic ignores temperature when thinking is enabled
    const context = requestToolContext(!!unattendedWake, sessionId)
    const callLimit = requestToolLimit(max_tool_calls, !!unattendedWake)
    const availableTools = toolsForContext(context)
    if (tools_enabled && allToolCalls.length < callLimit) body.tools = availableTools

    const res = await fetchUpstreamWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) }, { provider: 'anthropic', model })
    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json({ error: upstreamErrorMessage(res.status, errText) }, { status: res.status })
    }

    const data = await res.json()
    const usage = data.usage || {}
    totalUsage.input += usage.input_tokens || 0
    totalUsage.output += usage.output_tokens || 0
    totalUsage.cache_read += usage.cache_read_input_tokens || 0
    totalUsage.cache_create += usage.cache_creation_input_tokens || 0

    let iterText = ''
    let iterThinking = ''
    const toolUses: any[] = []

    for (const block of data.content || []) {
      if (block.type === 'thinking') iterThinking += block.thinking
      else if (block.type === 'text') iterText += block.text
      else if (block.type === 'tool_use') toolUses.push(block)
    }

    if (iterThinking) allThinking += (allThinking ? '\n---\n' : '') + iterThinking

    if (data.stop_reason !== 'tool_use' || toolUses.length === 0) {
      return NextResponse.json({
        content: iterText,
        thinking: allThinking || undefined,
        tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
        input_tokens: totalUsage.input,
        output_tokens: totalUsage.output,
        cache_read_tokens: totalUsage.cache_read || undefined,
        cache_creation_tokens: totalUsage.cache_create || undefined,
      })
    }

    const executions = await executeToolBatch(
      toolUses.map(tu => ({ name: tu.name, input: tu.input })),
      context,
      callLimit - allToolCalls.length,
    )
    const toolResults = executions.map((execution, index) => {
      const tu = toolUses[index]
      const result = localizeToolTimes(execution.result)
      allToolCalls.push({ name: tu.name, input: tu.input, result: toolResultForHistory(tu.name, result), error: execution.error })
      return { type: 'tool_result' as const, tool_use_id: tu.id, content: anthropicToolResultContent(tu.name, result, origin) }
    })

    loopMessages.push({ role: 'assistant', content: data.content })
    loopMessages.push({ role: 'user', content: toolResults })
  }

  return NextResponse.json({
    content: '(tool loop reached max iterations)',
    thinking: allThinking || undefined,
    tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    input_tokens: totalUsage.input,
    output_tokens: totalUsage.output,
  })
}

// ── Anthropic streaming ─────────────────────────────────

async function streamAnthropic(params: {
  messages: any[]; system?: string; model: string; apiKey: string;
  baseUrl: string; thinking_budget?: number; prompt_caching?: boolean;
  tools_enabled?: boolean; temperature?: number; bookmark_injections?: string; max_tool_calls?: number; origin?: string;
  unattendedWake?: boolean; sessionId?: string;
  send: (type: string, data: any) => void;
}) {
  const {
    messages, system, model, apiKey, baseUrl,
    thinking_budget, prompt_caching, tools_enabled, temperature,
    bookmark_injections, send, max_tool_calls, origin, unattendedWake, sessionId,
  } = params

  const effectiveSystem = (system && system.trim()) ? system : DEFAULT_SYSTEM_PROMPT
  const systemBlocks = buildAnthropicSystemBlocks(effectiveSystem, bookmark_injections || '', !!prompt_caching)
  const lastUserMsgS = messages.filter((m: any) => m.role === 'user').pop()?.content || ''
  const volatileCtxS = await buildVolatileContext(typeof lastUserMsgS === 'string' ? lastUserMsgS : '')
  const initialMessages = buildAnthropicMessages(messages, origin, !!prompt_caching, volatileCtxS)

  const budget = typeof thinking_budget === 'number' ? thinking_budget : 0
  const url = `${normalizeAnthropicBase(baseUrl)}/v1/messages`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    Authorization: `Bearer ${apiKey}`,
    'anthropic-version': '2023-06-01',
  }

  let loopMessages = [...initialMessages]
  const allToolCalls: ToolCallResult[] = []
  let totalUsage = { input: 0, output: 0, cache_read: 0, cache_create: 0 }

  const MAX_ITERATIONS = 15

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // Bridge layer: always enable thinking (reasoning)
    const effectiveBudget = budget > 0 ? budget : 8000
    const body: any = {
      model,
      // max_tokens must exceed thinking budget (it counts thinking + output)
      max_tokens: Math.max(16000, effectiveBudget + 4096),
      messages: sanitizeAnthropicMessages(loopMessages),
      stream: true,
      system: systemBlocks,
      metadata: { user_id: 'lumbre-starfire' },
    }

    body.thinking = { type: 'enabled', budget_tokens: effectiveBudget }
    const context = requestToolContext(!!unattendedWake, sessionId)
    const callLimit = requestToolLimit(max_tool_calls, !!unattendedWake)
    const availableTools = toolsForContext(context)
    if (tools_enabled && allToolCalls.length < callLimit) body.tools = availableTools

    const res = await fetchUpstreamWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) }, { provider: 'anthropic', model })
    if (!res.ok) {
      const errText = await res.text()
      send('error', { content: upstreamErrorMessage(res.status, errText).slice(0, 700) })
      return
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let iterText = ''
    let stopReason = ''
    const toolUses: any[] = []
    const toolInputBuffers: Record<number, string> = {}

    let iterThinking = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''

        for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const evt = JSON.parse(line.slice(6))
          if (evt.type === 'content_block_delta') {
            if (evt.delta?.type === 'text_delta') {
              iterText += evt.delta.text
              send('text', { content: evt.delta.text })
            } else if (evt.delta?.type === 'thinking_delta') {
              iterThinking += evt.delta.thinking || ''
              send('thinking', { content: evt.delta.thinking })
            } else if (evt.delta?.type === 'input_json_delta') {
              const idx = evt.index
              toolInputBuffers[idx] = (toolInputBuffers[idx] || '') + evt.delta.partial_json
            }
          } else if (evt.type === 'content_block_start') {
            if (evt.content_block?.type === 'tool_use') {
              toolUses.push({ ...evt.content_block, _index: evt.index })
            }
          } else if (evt.type === 'message_delta') {
            stopReason = evt.delta?.stop_reason || ''
            const u = evt.usage || {}
            totalUsage.output += u.output_tokens || 0
          } else if (evt.type === 'message_start') {
            const u = evt.message?.usage || {}
            totalUsage.input += u.input_tokens || 0
            totalUsage.cache_read += u.cache_read_input_tokens || 0
            totalUsage.cache_create += u.cache_creation_input_tokens || 0
          }
          } catch { /* skip malformed upstream event */ }
        }
      }
    } catch (err: any) {
      const hadOutput = !!(iterText.trim() || iterThinking.trim())
      logUpstreamStreamError({
        provider: 'anthropic', model, baseUrl, iteration: iter + 1,
        hadOutput, toolCallCount: allToolCalls.length, error: err,
      })
      send('error', { content: friendlyStreamError(err, hadOutput) })
      try { await reader.cancel() } catch {}
      return
    }

    for (const tu of toolUses) {
      const raw = toolInputBuffers[tu._index]
      try { tu.input = raw ? JSON.parse(raw) : {} } catch { tu.input = {} }
    }

    if (stopReason !== 'tool_use' || toolUses.length === 0) {
      send('done', {
        input_tokens: totalUsage.input,
        output_tokens: totalUsage.output,
        cache_read_tokens: totalUsage.cache_read || undefined,
        cache_creation_tokens: totalUsage.cache_create || undefined,
      })
      return
    }

    const contentBlocks: any[] = []
    if (iterText.trim()) contentBlocks.push({ type: 'text', text: iterText })
    for (const tu of toolUses) contentBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })

    const executions = await executeToolBatch(
      toolUses.map(tu => ({ name: tu.name, input: tu.input })),
      context,
      callLimit - allToolCalls.length,
    )
    const toolResults = executions.map((execution, index) => {
      const tu = toolUses[index]
      const result = localizeToolTimes(execution.result)
      const histResult = toolResultForHistory(tu.name, result)
      allToolCalls.push({ name: tu.name, input: tu.input, result: histResult, error: execution.error })
      send('tool_call', { name: tu.name, input: tu.input, result: histResult })
      return { type: 'tool_result' as const, tool_use_id: tu.id, content: anthropicToolResultContent(tu.name, result, origin) }
    })

    loopMessages.push({ role: 'assistant', content: contentBlocks })
    loopMessages.push({ role: 'user', content: toolResults })
  }

  send('done', { input_tokens: totalUsage.input, output_tokens: totalUsage.output })
}

// ── OpenAI-compatible non-streaming ─────────────────────

function toolsToOpenAI(tools: ToolDef[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
}

async function proxyOpenAI(params: {
  messages: any[]; system?: string; model: string;
  apiKey: string; baseUrl: string; thinking_budget?: number;
  tools_enabled?: boolean; temperature?: number; bookmark_injections?: string; max_tool_calls?: number; origin?: string;
  unattendedWake?: boolean; sessionId?: string;
}) {
  const { messages, system, model, apiKey, baseUrl, thinking_budget, tools_enabled = true, temperature, bookmark_injections, max_tool_calls, origin, unattendedWake, sessionId } = params

  const effectiveSystem = (system?.trim()) ? system : DEFAULT_SYSTEM_PROMPT
  const fullSystem = effectiveSystem + (bookmark_injections ? '\n\n' + bookmark_injections : '')
  
  // For OpenAI path: inject current time as volatile context in last user message
  const lastUserMsgOI = messages.filter((m: any) => m.role === 'user').pop()?.content || ''
  const volatileCtxOI = await buildVolatileContext(typeof lastUserMsgOI === 'string' ? lastUserMsgOI : '')
  const builtMessages: any[] = [
    { role: 'system', content: fullSystem },
    ...messages.map((m: any, i: number) => {
      const isLastUser = m.role === 'user' && i === messages.length - 1
      const text = isLastUser
        ? `<gateway_volatile_context>${volatileCtxOI}</gateway_volatile_context>\n\n${m.content}`
        : m.content
      const imgs = openaiImageParts(m.images, origin)
      if (imgs.length) return { role: m.role, content: [{ type: 'text', text }, ...imgs] }
      return { role: m.role, content: text }
    }),
  ]

  const context = requestToolContext(!!unattendedWake, sessionId)
  const callLimit = requestToolLimit(max_tool_calls, !!unattendedWake)
  const openaiTools = toolsToOpenAI(toolsForContext(context))
  const url = `${normalizeOpenAIBase(baseUrl)}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://lumbre.zeabur.app',
    'X-Title': 'Lumbre',
  }

  let loopMessages = [...builtMessages]
  let allThinking = ''
  const allToolCalls: ToolCallResult[] = []
  let totalUsage = { prompt: 0, completion: 0, cached: 0 }

  const MAX_ITERATIONS = 15

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // Bridge layer: always request reasoning for all models
    const effectiveBudget = (typeof thinking_budget === 'number' && thinking_budget > 0) ? thinking_budget : 8000
    const body: any = {
      model,
      messages: loopMessages,
      // max_tokens must exceed reasoning budget (relay maps it to thinking.budget_tokens)
      max_tokens: Math.max(16000, effectiveBudget + 4096),
      ...(tools_enabled && allToolCalls.length < callLimit ? { tools: openaiTools } : {}),
    }
    if (typeof temperature === 'number') body.temperature = temperature
    body.reasoning = { max_tokens: effectiveBudget }

    const res = await fetchUpstreamWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) }, { provider: 'openai-compatible', model })
    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json({ error: upstreamErrorMessage(res.status, errText) }, { status: res.status })
    }

    const data = await res.json()
    const usage = data.usage || {}
    totalUsage.prompt += usage.prompt_tokens || 0
    totalUsage.completion += usage.completion_tokens || 0
    totalUsage.cached += usage.prompt_tokens_details?.cached_tokens || 0

    const choice = data.choices?.[0]
    const msg = choice?.message
    if (!msg) {
      return NextResponse.json({ content: '(no response from model)', input_tokens: totalUsage.prompt, output_tokens: totalUsage.completion })
    }

    const iterThinking = msg.reasoning_content || msg.reasoning || msg.thinking || ''
    if (iterThinking) allThinking += (allThinking ? '\n---\n' : '') + iterThinking

    const iterText = Array.isArray(msg.content)
      ? msg.content.map((p: any) => p?.text || '').join('')
      : msg.content || ''

    const toolCalls = msg.tool_calls
    if (!toolCalls || toolCalls.length === 0) {
      return NextResponse.json({
        content: iterText,
        thinking: allThinking || undefined,
        tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
        input_tokens: totalUsage.prompt,
        output_tokens: totalUsage.completion,
        cache_read_tokens: totalUsage.cached || undefined,
      })
    }

    const parsedCalls = toolCalls.map((tc: any) => {
      let input: Record<string, any> = {}
      try { input = JSON.parse(tc.function?.arguments || '{}') } catch { /* empty */ }
      return { id: tc.id, name: tc.function?.name || '', input }
    })
    const executions = await executeToolBatch(parsedCalls, context, callLimit - allToolCalls.length)
    const photoPartsP: any[] = []
    const toolResults = executions.map((execution, index) => {
      const call = parsedCalls[index]
      const result = localizeToolTimes(execution.result)
      allToolCalls.push({ name: call.name, input: call.input, result: toolResultForHistory(call.name, result), error: execution.error })
      photoPartsP.push(...openaiPhotoFollowup(call.name, result, origin))
      return { role: 'tool' as const, tool_call_id: call.id, content: toolResultText(call.name, result) }
    })

    loopMessages.push(msg)
    loopMessages.push(...toolResults)
    if (photoPartsP.length) {
      loopMessages.push({ role: 'user', content: [{ type: 'text', text: '这是照片墙上照片的画面内容：' }, ...photoPartsP] })
    }
  }

  return NextResponse.json({
    content: '(tool loop reached max iterations)',
    thinking: allThinking || undefined,
    tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    input_tokens: totalUsage.prompt,
    output_tokens: totalUsage.completion,
  })
}

// ── OpenAI streaming ────────────────────────────────────

async function streamOpenAI(params: {
  messages: any[]; system?: string; model: string;
  apiKey: string; baseUrl: string; thinking_budget?: number;
  tools_enabled?: boolean; temperature?: number; bookmark_injections?: string; max_tool_calls?: number; origin?: string;
  unattendedWake?: boolean; sessionId?: string;
  send: (type: string, data: any) => void;
}) {
  const { messages, system, model, apiKey, baseUrl, thinking_budget, tools_enabled = true, temperature, bookmark_injections, send, max_tool_calls, origin, unattendedWake, sessionId } = params

  const effectiveSystem = (system?.trim()) ? system : DEFAULT_SYSTEM_PROMPT
  const fullSystem = effectiveSystem + (bookmark_injections ? '\n\n' + bookmark_injections : '')
  const lastUserMsgSO = messages.filter((m: any) => m.role === 'user').pop()?.content || ''
  const volatileCtxSO = await buildVolatileContext(typeof lastUserMsgSO === 'string' ? lastUserMsgSO : '')
  const builtMessages: any[] = [
    { role: 'system', content: fullSystem },
    ...messages.map((m: any, i: number) => {
      const isLastUser = m.role === 'user' && i === messages.length - 1
      const text = isLastUser
        ? `<gateway_volatile_context>${volatileCtxSO}</gateway_volatile_context>\n\n${m.content}`
        : m.content
      const imgs = openaiImageParts(m.images, origin)
      if (imgs.length) return { role: m.role, content: [{ type: 'text', text }, ...imgs] }
      return { role: m.role, content: text }
    }),
  ]

  const context = requestToolContext(!!unattendedWake, sessionId)
  const callLimit = requestToolLimit(max_tool_calls, !!unattendedWake)
  const openaiTools = toolsToOpenAI(toolsForContext(context))
  const url = `${normalizeOpenAIBase(baseUrl)}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://lumbre.zeabur.app',
    'X-Title': 'Lumbre',
  }

  let loopMessages = [...builtMessages]
  let totalUsage = { prompt: 0, completion: 0, cached: 0 }
  let toolCallCount = 0

  const MAX_ITERATIONS = 15

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    // Bridge layer: always request reasoning
    const effectiveStreamBudget = (typeof thinking_budget === 'number' && thinking_budget > 0) ? thinking_budget : 8000
    const body: any = {
      model,
      messages: loopMessages,
      // max_tokens must exceed reasoning budget (relay maps it to thinking.budget_tokens)
      max_tokens: Math.max(16000, effectiveStreamBudget + 4096),
      stream: true,
      stream_options: { include_usage: true },
      ...(tools_enabled && toolCallCount < callLimit ? { tools: openaiTools } : {}),
    }
    if (typeof temperature === 'number') body.temperature = temperature
    body.reasoning = { max_tokens: effectiveStreamBudget }

    const res = await fetchUpstreamWithRetry(url, { method: 'POST', headers, body: JSON.stringify(body) }, { provider: 'openai-compatible', model })
    if (!res.ok) {
      const errText = await res.text()
      send('error', { content: upstreamErrorMessage(res.status, errText).slice(0, 700) })
      return
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let iterText = ''
    let iterThinking = ''
    let finishReason = ''
    const toolCallMap: Record<number, { id: string; name: string; args: string }> = {}

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''

        for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
        try {
          const chunk = JSON.parse(line.slice(6))
          // Usage arrives in a final chunk whose choices[] is empty — capture it
          // BEFORE bailing on the missing delta, or tokens never get counted.
          if (chunk.usage) {
            totalUsage.prompt += chunk.usage.prompt_tokens || 0
            totalUsage.completion += chunk.usage.completion_tokens || 0
            totalUsage.cached += chunk.usage.prompt_tokens_details?.cached_tokens || 0
          }
          const fr = chunk.choices?.[0]?.finish_reason
          if (fr) finishReason = fr
          const delta = chunk.choices?.[0]?.delta
          if (!delta) continue

          if (delta.content) {
            iterText += delta.content
            send('text', { content: delta.content })
          }
          if (delta.reasoning_content || delta.reasoning) {
            const t = delta.reasoning_content || delta.reasoning
            iterThinking += t
            send('thinking', { content: t })
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              if (!toolCallMap[idx]) toolCallMap[idx] = { id: tc.id || '', name: '', args: '' }
              if (tc.id) toolCallMap[idx].id = tc.id
              if (tc.function?.name) toolCallMap[idx].name = tc.function.name
              if (tc.function?.arguments) toolCallMap[idx].args += tc.function.arguments
            }
          }
          } catch { /* skip malformed upstream chunk */ }
        }
      }
    } catch (err: any) {
      const hadOutput = !!(iterText.trim() || iterThinking.trim())
      logUpstreamStreamError({
        provider: 'openai-compatible', model, baseUrl, iteration: iter + 1,
        hadOutput, toolCallCount, error: err,
      })
      send('error', { content: friendlyStreamError(err, hadOutput) })
      try { await reader.cancel() } catch {}
      return
    }

    const toolCalls = Object.values(toolCallMap)
    // Upstream aborted the stream (relay finish_reason=error) with no usable output.
    // Common cause: the selected model channel doesn't support tool/function calling.
    // Surface a clear error instead of a silent empty "done".
    if (finishReason === 'error' && toolCalls.length === 0 && !iterText.trim()) {
      send('error', { content: '上游模型返回错误（finish_reason=error），通常是当前模型渠道不支持工具调用。请在设置里换一个支持工具的模型（例如 按量寿眉-claude-opus-4-6 或 白毫-claude-opus-4-6）。' })
      return
    }
    if (toolCalls.length === 0) {
      send('done', { input_tokens: totalUsage.prompt, output_tokens: totalUsage.completion, cache_read_tokens: totalUsage.cached || undefined })
      return
    }

    const assistantMsg: any = { role: 'assistant', content: iterText || null, tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } })) }
    loopMessages.push(assistantMsg)

    const parsedCalls = toolCalls.map(tc => {
      let input: Record<string, any> = {}
      try { input = JSON.parse(tc.args || '{}') } catch { /* empty */ }
      return { id: tc.id, name: tc.name, input }
    })
    const executions = await executeToolBatch(parsedCalls, context, callLimit - toolCallCount)
    const photoPartsSO: any[] = []
    const results = executions.map((execution, index) => {
      const call = parsedCalls[index]
      const result = localizeToolTimes(execution.result)
      toolCallCount++
      send('tool_call', { name: call.name, input: call.input, result: toolResultForHistory(call.name, result) })
      photoPartsSO.push(...openaiPhotoFollowup(call.name, result, origin))
      return { role: 'tool' as const, tool_call_id: call.id, content: toolResultText(call.name, result) }
    })
    loopMessages.push(...results)
    if (photoPartsSO.length) {
      loopMessages.push({ role: 'user', content: [{ type: 'text', text: '这是照片墙上照片的画面内容：' }, ...photoPartsSO] })
    }
  }

  send('done', { input_tokens: totalUsage.prompt, output_tokens: totalUsage.completion, cache_read_tokens: totalUsage.cached || undefined })
}
