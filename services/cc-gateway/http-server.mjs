import http from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { AttemptValidationError } from './attempt-ledger.mjs'
import { ContextBridgeValidationError } from './context-bridge.mjs'
import { PINNED_CLAUDE_CODE_VERSION } from '../cc-probe/contract.mjs'

const TERMINAL = new Set(['completed', 'failed', 'cancelled'])
const CONVERSATION_ID = /^[A-Za-z0-9._:-]{1,160}$/

function json(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

function authorized(request, secret) {
  const header = request.headers.authorization || ''
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : ''
  const expectedBytes = Buffer.from(secret)
  const suppliedBytes = Buffer.from(supplied)
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
}

async function readBody(request, limit = 1_600_000) {
  const declared = Number(request.headers['content-length'] || 0)
  if (declared > limit) throw new AttemptValidationError('Request body is too large')
  let text = ''
  for await (const chunk of request) {
    text += chunk
    if (Buffer.byteLength(text) > limit) throw new AttemptValidationError('Request body is too large')
  }
  try { return JSON.parse(text || '{}') }
  catch { throw new AttemptValidationError('Request body must be valid JSON') }
}

function sendSse(response, event) {
  response.write(`id: ${event.id}\n`)
  response.write(`event: ${event.type}\n`)
  response.write(`data: ${JSON.stringify(event)}\n\n`)
}

export function createGatewayServer({ runtime, secret, heartbeatMs = 15_000 }) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('LUMBRE_CC_GATEWAY_SECRET must be at least 32 characters')

  return http.createServer(async (request, response) => {
    response.setHeader('x-content-type-options', 'nosniff')
    const url = new URL(request.url || '/', 'http://cc-gateway.local')

    if (request.method === 'GET' && url.pathname === '/healthz') {
      return json(response, 200, {
        status: 'ok',
        claudeCodeVersion: PINNED_CLAUDE_CODE_VERSION,
        capabilities: runtime.capabilities?.() || { lumbreTools: false },
      })
    }
    if (!authorized(request, secret)) return json(response, 401, { error: 'unauthorized' })

    try {
      if (request.method === 'GET' && url.pathname === '/v1/metrics') {
        const conversationId = url.searchParams.get('conversation_id') || ''
        if (!CONVERSATION_ID.test(conversationId)) throw new AttemptValidationError('conversation_id is invalid')
        return json(response, 200, await runtime.metrics(conversationId))
      }

      if (request.method === 'GET' && url.pathname === '/v1/busy') {
        return json(response, 200, { busy: runtime.busy() })
      }

      if (request.method === 'POST' && url.pathname === '/v1/warm-cache') {
        const body = await readBody(request, 8_000)
        const conversationId = body.conversation_id || ''
        if (!CONVERSATION_ID.test(conversationId)) throw new AttemptValidationError('conversation_id is invalid')
        const result = await runtime.warm(conversationId)
        return json(response, result.status === 'busy' ? 409 : result.status === 'failed' ? 502 : 200, result)
      }

      if (request.method === 'POST' && url.pathname === '/v1/attempts') {
        const body = await readBody(request)
        const result = runtime.submit({
          idempotencyKey: body.idempotency_key,
          conversationId: body.conversation_id,
          prompt: body.prompt,
          model: body.model,
          context: body.context,
          sessionAction: body.session_action,
          unattended: body.unattended === true,
        })
        return json(response, result.reused ? 200 : 202, result)
      }

      if (request.method === 'POST' && url.pathname === '/v1/attempts/cancel-by-key') {
        const body = await readBody(request, 8_000)
        const attempt = runtime.cancelByIdempotencyKey(body.idempotency_key)
        return attempt ? json(response, 202, { attempt }) : json(response, 404, { error: 'not_found' })
      }

      const match = url.pathname.match(/^\/v1\/attempts\/([0-9a-f-]{36})(?:\/(events|cancel))?$/i)
      if (!match) return json(response, 404, { error: 'not_found' })
      const [, id, action] = match

      if (request.method === 'GET' && !action) {
        const attempt = runtime.get(id)
        return attempt ? json(response, 200, { attempt }) : json(response, 404, { error: 'not_found' })
      }

      if (request.method === 'POST' && action === 'cancel') {
        const attempt = runtime.cancel(id)
        return attempt ? json(response, 202, { attempt }) : json(response, 404, { error: 'not_found' })
      }

      if (request.method === 'GET' && action === 'events') {
        const lastHeader = Number(request.headers['last-event-id'] || 0)
        const lastQuery = Number(url.searchParams.get('after') || 0)
        const after = Number.isSafeInteger(lastHeader) && lastHeader > 0 ? lastHeader
          : Number.isSafeInteger(lastQuery) && lastQuery > 0 ? lastQuery : 0
        const events = runtime.getEvents(id, after)
        if (!events) return json(response, 404, { error: 'not_found' })

        response.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        response.write(': connected\n\n')
        for (const event of events) sendSse(response, event)
        const current = runtime.get(id)
        if (current && TERMINAL.has(current.status)) return response.end()

        let unsubscribe = () => {}
        let heartbeat
        let cleanedUp = false
        const cleanup = () => {
          if (cleanedUp) return
          cleanedUp = true
          if (heartbeat) clearInterval(heartbeat)
          unsubscribe()
        }
        unsubscribe = runtime.subscribe(id, event => {
          sendSse(response, event)
          if (TERMINAL.has(event.type)) {
            cleanup()
            response.end()
          }
        })
        heartbeat = setInterval(() => response.write(': keepalive\n\n'), heartbeatMs)
        heartbeat.unref()
        request.on('close', cleanup)
        return
      }

      return json(response, 404, { error: 'not_found' })
    } catch (error) {
      if (error instanceof AttemptValidationError || error instanceof ContextBridgeValidationError) return json(response, 400, { error: error.message })
      return json(response, 500, { error: 'internal_error' })
    }
  })
}
