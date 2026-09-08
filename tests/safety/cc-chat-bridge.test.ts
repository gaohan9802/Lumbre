import assert from 'node:assert/strict'
import test from 'node:test'

import { readChatEventStream } from '../../src/features/chat/api/event-stream'
import { cancelCcAttempt, createCcChatResponse, isCcGatewayBusy, readCcStatus, warmCcSession } from '../../src/server/chat/cc-gateway'

const SECRET = 'cc-chat-bridge-fixture-secret-000000000'
const ATTEMPT_ID = '550e8400-e29b-41d4-a716-446655440000'
const SESSION_ID = '123e4567-e89b-42d3-a456-426614174000'

function configure() {
  const previous = {
    url: process.env.LUMBRE_CC_GATEWAY_URL,
    secret: process.env.LUMBRE_CC_GATEWAY_SECRET,
    model: process.env.LUMBRE_CC_MODEL,
  }
  process.env.LUMBRE_CC_GATEWAY_URL = 'https://cc-gateway.example'
  process.env.LUMBRE_CC_GATEWAY_SECRET = SECRET
  process.env.LUMBRE_CC_MODEL = 'sonnet'
  return () => {
    if (previous.url === undefined) delete process.env.LUMBRE_CC_GATEWAY_URL
    else process.env.LUMBRE_CC_GATEWAY_URL = previous.url
    if (previous.secret === undefined) delete process.env.LUMBRE_CC_GATEWAY_SECRET
    else process.env.LUMBRE_CC_GATEWAY_SECRET = previous.secret
    if (previous.model === undefined) delete process.env.LUMBRE_CC_MODEL
    else process.env.LUMBRE_CC_MODEL = previous.model
  }
}

test('Lumbre proxies one CC attempt as its normal chat stream without exposing the session id', async () => {
  const restore = configure()
  let submitted: any
  const calls: string[] = []
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push(url)
    assert.equal((init?.headers as Record<string, string>)?.authorization, `Bearer ${SECRET}`)
    if (url.endsWith('/v1/attempts') && init?.method === 'POST') {
      submitted = JSON.parse(String(init.body))
      return Response.json({ attempt: { id: ATTEMPT_ID, status: 'queued', sessionMode: 'bootstrap', sessionReason: 'first_cc_turn' } }, { status: 202 })
    }
    if (url.endsWith(`/v1/attempts/${ATTEMPT_ID}/events`)) {
      return new Response([
        `data: ${JSON.stringify({ id: 1, type: 'queued' })}`,
        `data: ${JSON.stringify({ id: 2, type: 'thinking', content: '先想一想' })}`,
        `data: ${JSON.stringify({ id: 3, type: 'text', content: '星星回来啦' })}`,
        `data: ${JSON.stringify({ id: 4, type: 'completed' })}`,
        '',
      ].join('\n\n'), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    if (url.endsWith(`/v1/attempts/${ATTEMPT_ID}`)) {
      return Response.json({ attempt: {
        id: ATTEMPT_ID, status: 'completed', sessionMode: 'bootstrap', sessionReason: 'first_cc_turn',
        result: {
          text: '星星回来啦', sessionId: SESSION_ID,
          usage: { input_tokens: 4, output_tokens: 5, cache_read_input_tokens: 6, cache_creation_input_tokens: 7 },
        },
      } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }

  try {
    const response = await createCcChatResponse({
      body: {
        stream: true, session_id: 'conversation-1', turn_id: 'turn-1',
        _wake: true,
        messages: [{ id: 'turn-1', role: 'user', route: 'claude-code', content: '回来吗' }],
        bookmark_injections: 'shared summary',
      },
      system: 'You are Star.',
      volatileContext: 'Madrid now',
      fetchImpl: fakeFetch,
    })
    assert.equal(response.status, 200)
    const events = []
    for await (const event of readChatEventStream(response)) events.push(event)
    assert.deepEqual(events.map(event => event.type), ['attempt', 'thinking', 'text', 'done'])
    assert.equal(events[1].content, '先想一想')
    assert.equal(events[2].content, '星星回来啦')
    assert.equal(events[3].attempt_id, ATTEMPT_ID)
    assert.equal(events[3].session_fingerprint, '320159ebe321')
    assert.equal(events[3].cache_read_tokens, 6)
    assert.doesNotMatch(JSON.stringify(events), new RegExp(SESSION_ID))
    assert.equal(submitted.idempotency_key, 'lumbre:conversation-1:turn-1')
    assert.equal(submitted.context.messages[0].id, 'turn-1')
    assert.equal(submitted.context.bookmarkInjections, 'shared summary')
    assert.equal(submitted.unattended, true)
    assert.equal(calls.length, 3)
  } finally { restore() }
})

test('Lumbre reconnects a prematurely closed gateway stream from its last durable event', async () => {
  const restore = configure()
  const eventUrls: string[] = []
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/v1/attempts')) {
      return Response.json({ attempt: { id: ATTEMPT_ID, status: 'queued', sessionMode: 'resume', sessionReason: 'ordinary_delta' } }, { status: 202 })
    }
    if (url.includes(`/v1/attempts/${ATTEMPT_ID}/events`)) {
      eventUrls.push(url)
      if (eventUrls.length === 1) {
        return new Response([
          `data: ${JSON.stringify({ id: 1, type: 'queued' })}`,
          `data: ${JSON.stringify({ id: 2, type: 'text', content: '星星' })}`,
          '',
        ].join('\n\n'))
      }
      assert.match(url, /\?after=2$/)
      return new Response([
        `data: ${JSON.stringify({ id: 3, type: 'text', content: '回来啦' })}`,
        `data: ${JSON.stringify({ id: 4, type: 'completed' })}`,
        '',
      ].join('\n\n'))
    }
    if (url.endsWith(`/v1/attempts/${ATTEMPT_ID}`)) {
      return Response.json({ attempt: {
        id: ATTEMPT_ID, status: 'completed', sessionMode: 'resume', sessionReason: 'ordinary_delta',
        result: { text: '星星回来啦', sessionId: SESSION_ID, usage: { output_tokens: 4 }, compacted: false },
      } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  try {
    const response = await createCcChatResponse({
      body: {
        stream: true, session_id: 'conversation-1', turn_id: 'turn-2',
        messages: [{ id: 'turn-2', role: 'user', route: 'claude-code', content: '回来吗' }],
      },
      system: 'You are Star.',
      volatileContext: '',
      fetchImpl: fakeFetch,
    })
    const events = []
    for await (const event of readChatEventStream(response)) events.push(event)
    assert.deepEqual(events.map(event => event.type), ['attempt', 'text', 'text', 'done'])
    assert.equal(events.filter(event => event.type === 'text').map(event => event.content).join(''), '星星回来啦')
    assert.equal(eventUrls.length, 2)
  } finally { restore() }
})

test('Lumbre forwards durable CC tool events through the existing chat tool UI protocol', async () => {
  const restore = configure()
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/v1/attempts')) {
      return Response.json({ attempt: { id: ATTEMPT_ID, status: 'queued', sessionMode: 'resume', sessionReason: 'ordinary_delta' } }, { status: 202 })
    }
    if (url.endsWith(`/v1/attempts/${ATTEMPT_ID}/events`)) {
      return new Response([
        `data: ${JSON.stringify({ id: 1, type: 'queued' })}`,
        `data: ${JSON.stringify({ id: 2, type: 'tool_call', name: 'read_period', input: {}, result: '{"ok":true}', error: false })}`,
        `data: ${JSON.stringify({ id: 3, type: 'text', content: '我看过啦' })}`,
        `data: ${JSON.stringify({ id: 4, type: 'completed' })}`,
        '',
      ].join('\n\n'))
    }
    if (url.endsWith(`/v1/attempts/${ATTEMPT_ID}`)) {
      return Response.json({ attempt: {
        id: ATTEMPT_ID, status: 'completed', sessionMode: 'resume', sessionReason: 'ordinary_delta',
        result: { text: '我看过啦', sessionId: SESSION_ID, usage: { output_tokens: 4 } },
      } })
    }
    throw new Error(`unexpected fetch ${url}`)
  }
  try {
    const response = await createCcChatResponse({
      body: { stream: true, session_id: 'conversation-1', turn_id: 'turn-tool', messages: [] },
      system: 'You are Star.', volatileContext: '', fetchImpl: fakeFetch,
    })
    const events = []
    for await (const event of readChatEventStream(response)) events.push(event)
    assert.deepEqual(events.map(event => event.type), ['attempt', 'tool_call', 'text', 'done'])
    assert.equal(events[1].name, 'read_period')
  } finally { restore() }
})

test('CC configuration failure is explicit and never invokes an API fallback', async () => {
  const oldUrl = process.env.LUMBRE_CC_GATEWAY_URL
  const oldSecret = process.env.LUMBRE_CC_GATEWAY_SECRET
  delete process.env.LUMBRE_CC_GATEWAY_URL
  delete process.env.LUMBRE_CC_GATEWAY_SECRET
  try {
    let called = false
    const response = await createCcChatResponse({
      body: { stream: true }, system: '', volatileContext: '',
      fetchImpl: async () => { called = true; throw new Error('must not call') },
    })
    assert.equal(response.status, 503)
    assert.match(await response.text(), /不会自动改走 API/)
    assert.equal(called, false)
  } finally {
    if (oldUrl === undefined) delete process.env.LUMBRE_CC_GATEWAY_URL
    else process.env.LUMBRE_CC_GATEWAY_URL = oldUrl
    if (oldSecret === undefined) delete process.env.LUMBRE_CC_GATEWAY_SECRET
    else process.env.LUMBRE_CC_GATEWAY_SECRET = oldSecret
  }
})

test('status and explicit cancel use server-only gateway credentials', async () => {
  const restore = configure()
  const requests: Array<{ url: string; init?: RequestInit }> = []
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input)
    requests.push({ url, init })
    if (url.endsWith('/healthz')) return Response.json({ status: 'ok', claudeCodeVersion: '2.1.236', capabilities: { lumbreTools: true } })
    if (url.includes('/v1/metrics?conversation_id=conversation-1')) return Response.json({
      quota: { available: false, reason: 'headless_not_exposed', source: 'claude_code_headless', collectedAt: null },
      context: { available: true, usedTokens: 8740, maxTokens: 200000, usedPercentage: 4.4, model: 'claude-sonnet-4-6', source: 'last_assistant_usage', collectedAt: '2026-09-07T12:00:00.000Z' },
    })
    if (url.endsWith('/cancel-by-key')) return Response.json({ attempt: { id: ATTEMPT_ID, status: 'running' } }, { status: 202 })
    if (url.endsWith('/v1/busy')) return Response.json({ busy: true })
    if (url.endsWith('/v1/warm-cache')) return Response.json({ status: 'warmed', usage: { cache_read_input_tokens: 9000 } })
    throw new Error(`unexpected fetch ${url}`)
  }
  try {
    const status = await readCcStatus('conversation-1', fakeFetch)
    assert.equal(status.available, true)
    assert.equal(status.context.usedTokens, 8740)
    assert.equal(status.quota.reason, 'headless_not_exposed')
    const cancelled = await cancelCcAttempt({ session_id: 'conversation-1', turn_id: 'turn-1' }, fakeFetch)
    assert.equal(cancelled.ok, true)
    assert.equal(cancelled.attempt?.status, 'running')
    const cancelBody = JSON.parse(String(requests[2].init?.body))
    assert.equal(cancelBody.idempotency_key, 'lumbre:conversation-1:turn-1')
    assert.equal((requests[2].init?.headers as Record<string, string>).authorization, `Bearer ${SECRET}`)
    assert.equal(await isCcGatewayBusy(fakeFetch), true)
    const warmed = await warmCcSession('conversation-1', fakeFetch)
    assert.equal(warmed.status, 'warmed')
  } finally { restore() }
})
