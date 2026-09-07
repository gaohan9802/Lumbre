import { createHash } from 'node:crypto'

type FetchLike = typeof fetch

type CcGatewayConfig = {
  baseUrl: string
  secret: string
  model: string
}

type CcAttempt = {
  id: string
  status: string
  result?: {
    text?: string
    sessionId?: string
    usage?: Record<string, number> | null
    compacted?: boolean
  } | null
  error?: { code?: string; message?: string } | null
  sessionMode?: 'bootstrap' | 'resume' | 'rebase' | null
  sessionReason?: string | null
}

type CcMetrics = {
  quota: { available: boolean; reason?: string; source: string; collectedAt: string | null }
  context: {
    available: boolean
    reason?: string
    source: string
    collectedAt: string | null
    usedTokens?: number
    maxTokens?: number | null
    usedPercentage?: number | null
    model?: string | null
    cacheReadTokens?: number
    cacheCreationTokens?: number
  }
}

const SAFE_TURN_ID = /^[A-Za-z0-9._:-]{1,180}$/

function configFromEnvironment(env = process.env): CcGatewayConfig | null {
  const rawUrl = String(env.LUMBRE_CC_GATEWAY_URL || '').trim()
  const secret = String(env.LUMBRE_CC_GATEWAY_SECRET || '')
  if (!rawUrl || secret.length < 32) return null
  let url: URL
  try { url = new URL(rawUrl) } catch { return null }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return null
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !loopback && env.LUMBRE_CC_GATEWAY_ALLOW_INSECURE_HTTP !== '1') return null
  return {
    baseUrl: url.toString().replace(/\/$/, ''),
    secret,
    model: String(env.LUMBRE_CC_MODEL || 'sonnet').trim() || 'sonnet',
  }
}

async function gatewayFetch(config: CcGatewayConfig, pathname: string, init: RequestInit, fetchImpl: FetchLike, timeoutMs = 15_000) {
  const controller = new AbortController()
  const timer = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
  timer?.unref?.()
  try {
    return await fetchImpl(`${config.baseUrl}${pathname}`, {
      ...init,
      headers: {
        authorization: `Bearer ${config.secret}`,
        ...(init.headers || {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    })
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function safeJson(response: Response) {
  const text = await response.text()
  try { return text ? JSON.parse(text) : {} } catch { return {} }
}

function idempotencyKey(sessionId: string, turnId: string) {
  return `lumbre:${sessionId}:${turnId}`
}

function validateTurn(sessionId: unknown, turnId: unknown) {
  if (typeof sessionId !== 'string' || !SAFE_TURN_ID.test(sessionId)) throw new Error('CC 对话 id 无效')
  if (typeof turnId !== 'string' || !SAFE_TURN_ID.test(turnId)) throw new Error('CC 消息 id 无效')
  return { sessionId, turnId }
}

async function submitAttempt(config: CcGatewayConfig, body: any, system: string, volatileContext: string, fetchImpl: FetchLike) {
  const { sessionId, turnId } = validateTurn(body.session_id, body.turn_id)
  const response = await gatewayFetch(config, '/v1/attempts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      idempotency_key: idempotencyKey(sessionId, turnId),
      conversation_id: sessionId,
      model: config.model,
      session_action: body.cc_session_action === 'rebase' ? 'rebase' : undefined,
      context: {
        system,
        bookmarkInjections: typeof body.bookmark_injections === 'string' ? body.bookmark_injections : '',
        volatileContext,
        messages: Array.isArray(body.messages) ? body.messages : [],
      },
    }),
  }, fetchImpl)
  const data = await safeJson(response)
  if (!response.ok || !data?.attempt?.id) throw new Error(data?.error || `CC 网关拒绝了任务 (${response.status})`)
  return data.attempt as CcAttempt
}

async function readAttempt(config: CcGatewayConfig, id: string, fetchImpl: FetchLike) {
  const response = await gatewayFetch(config, `/v1/attempts/${encodeURIComponent(id)}`, {}, fetchImpl)
  const data = await safeJson(response)
  if (!response.ok || !data?.attempt) throw new Error(data?.error || `无法读取 CC 任务 (${response.status})`)
  return data.attempt as CcAttempt
}

async function* gatewayEvents(response: Response): AsyncGenerator<any> {
  if (!response.body) throw new Error('CC 网关没有返回事件流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frames = buffer.split('\n\n')
      buffer = frames.pop() || ''
      for (const frame of frames) {
        const line = frame.split('\n').find(item => item.startsWith('data: '))
        if (!line) continue
        try { yield JSON.parse(line.slice(6)) } catch { /* ignore malformed proxy frames */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function sessionFingerprint(sessionId?: string) {
  return sessionId ? createHash('sha256').update(sessionId).digest('hex').slice(0, 12) : undefined
}

function usagePayload(usage?: Record<string, number> | null) {
  return {
    input_tokens: usage?.input_tokens,
    output_tokens: usage?.output_tokens,
    cache_read_tokens: usage?.cache_read_input_tokens,
    cache_creation_tokens: usage?.cache_creation_input_tokens,
  }
}

export async function createCcChatResponse({
  body,
  system,
  volatileContext,
  fetchImpl = fetch,
}: {
  body: any
  system: string
  volatileContext: string
  fetchImpl?: FetchLike
}): Promise<Response> {
  const config = configFromEnvironment()
  if (!config) return Response.json({ error: 'CC 网关尚未安全配置；不会自动改走 API。' }, { status: 503 })
  if (body.stream !== true) return Response.json({ error: 'CC 线路目前只接受流式聊天。' }, { status: 400 })

  let submitted: CcAttempt
  try {
    submitted = await submitAttempt(config, body, system, volatileContext, fetchImpl)
  } catch (error: any) {
    return Response.json({ error: error?.message || 'CC 网关连接失败；不会自动改走 API。' }, { status: 502 })
  }

  const encoder = new TextEncoder()
  let clientClosed = false
  const stream = new ReadableStream({
    async start(controller) {
      let textSeen = false
      const send = (value: unknown) => {
        if (clientClosed) return
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(value)}\n\n`)) }
        catch { clientClosed = true }
      }
      send({ type: 'attempt', attempt_id: submitted.id, session_mode: submitted.sessionMode, session_reason: submitted.sessionReason })
      const heartbeat = setInterval(() => {
        if (!clientClosed) try { controller.enqueue(encoder.encode(': keepalive\n\n')) } catch { clientClosed = true }
      }, 10_000)
      let lastEventId = 0
      let terminal = false
      let reconnectFailures = 0
      try {
        while (!terminal && !clientClosed) {
          try {
            const suffix = lastEventId ? `?after=${lastEventId}` : ''
            const upstream = await gatewayFetch(config, `/v1/attempts/${encodeURIComponent(submitted.id)}/events${suffix}`, {}, fetchImpl, 0)
            if (!upstream.ok) throw new Error(`无法连接 CC 任务事件流 (${upstream.status})`)
            for await (const event of gatewayEvents(upstream)) {
              if (event.type === 'text') {
                textSeen = true
                send({ type: 'text', content: String(event.content || '') })
              } else if (event.type === 'tool_call') {
                send({
                  type: 'tool_call',
                  name: String(event.name || ''),
                  input: event.input && typeof event.input === 'object' ? event.input : {},
                  result: String(event.result || ''),
                  error: event.error === true,
                })
              } else if (event.type === 'completed') {
                const final = await readAttempt(config, submitted.id, fetchImpl)
                if (!textSeen && final.result?.text) send({ type: 'text', content: final.result.text })
                send({
                  type: 'done',
                  ...usagePayload(final.result?.usage),
                  attempt_id: final.id,
                  route: 'claude-code',
                  model: config.model,
                  session_fingerprint: sessionFingerprint(final.result?.sessionId),
                  session_mode: final.sessionMode,
                  session_reason: final.sessionReason,
                  compacted: final.result?.compacted === true,
                })
                terminal = true
              } else if (event.type === 'failed') {
                send({ type: 'error', content: event.error?.message || 'CC 请求失败；没有改走 API。', code: event.error?.code })
                terminal = true
              } else if (event.type === 'cancelled') {
                send({ type: 'error', content: 'CC 生成已取消。', code: 'cancelled' })
                terminal = true
              }
              if (Number.isSafeInteger(event.id) && event.id > lastEventId) lastEventId = event.id
              if (terminal) break
            }
            if (!terminal) reconnectFailures++
          } catch {
            reconnectFailures++
          }
          if (reconnectFailures >= 4) break
        }
        if (!terminal && !clientClosed) {
          send({ type: 'recoverable_disconnect', content: 'CC 仍可能在后台运行，稍后会按同一轮取回。' })
        }
      } finally {
        clearInterval(heartbeat)
        if (!clientClosed) {
          try {
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          } catch {}
        }
      }
    },
    cancel() {
      // A browser/PWA disconnect is not authorization to cancel the CC task.
      clientClosed = true
    },
  })
  return new Response(stream, { headers: {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  } })
}

export async function cancelCcAttempt(body: any, fetchImpl: FetchLike = fetch) {
  const config = configFromEnvironment()
  if (!config) return { ok: false, status: 503, error: 'CC 网关尚未安全配置。' }
  const { sessionId, turnId } = validateTurn(body.session_id, body.turn_id)
  try {
    const response = await gatewayFetch(config, '/v1/attempts/cancel-by-key', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idempotency_key: idempotencyKey(sessionId, turnId) }),
    }, fetchImpl)
    const data = await safeJson(response)
    return response.ok ? { ok: true, status: response.status, attempt: data.attempt } : { ok: false, status: response.status, error: data?.error || '取消失败' }
  } catch {
    return { ok: false, status: 502, error: '无法连接 CC 网关' }
  }
}

export async function readCcStatus(conversationId?: string, fetchImpl: FetchLike = fetch) {
  const config = configFromEnvironment()
  const unavailableMetrics: CcMetrics = {
    quota: { available: false, reason: 'gateway_unavailable', source: 'claude_code_headless', collectedAt: null },
    context: { available: false, reason: 'gateway_unavailable', source: 'last_assistant_usage', collectedAt: null },
  }
  if (!config) return { configured: false, available: false, toolsAvailable: false, model: null, version: null, ...unavailableMetrics }
  try {
    const response = await gatewayFetch(config, '/healthz', {}, fetchImpl, 4_000)
    const data = await safeJson(response)
    const available = response.ok && data?.status === 'ok'
    let metrics: CcMetrics = unavailableMetrics
    if (available && conversationId && SAFE_TURN_ID.test(conversationId)) {
      try {
        const metricsResponse = await gatewayFetch(config, `/v1/metrics?conversation_id=${encodeURIComponent(conversationId)}`, {}, fetchImpl, 4_000)
        if (metricsResponse.ok) metrics = await safeJson(metricsResponse)
      } catch { /* health remains useful when metrics are temporarily unavailable */ }
    }
    return {
      configured: true,
      available,
      toolsAvailable: available && data?.capabilities?.lumbreTools === true,
      model: config.model,
      version: typeof data?.claudeCodeVersion === 'string' ? data.claudeCodeVersion : null,
      ...metrics,
    }
  } catch {
    return { configured: true, available: false, toolsAvailable: false, model: config.model, version: null, ...unavailableMetrics }
  }
}
