import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'lumbre-model-gateway-'))
process.env.DATA_DIR = testDataDir
process.env.LUMBRE_AUTH_SECRET = 'model-gateway-test-secret-that-is-long-enough'

after(() => rmSync(testDataDir, { recursive: true, force: true }))

test('model credentials are encrypted at rest and resolve only on the server', async () => {
  const repository = await import('../../src/server/data/repositories/model-credentials')
  repository.upsertModelCredential({ id: 'channel-a', provider: 'anthropic', baseUrl: 'https://relay.example/v1', apiKey: 'top-secret-fixture-key' })
  const stored = readFileSync(path.join(testDataDir, 'model-gateway', 'credentials.json'), 'utf8')
  assert.doesNotMatch(stored, /top-secret-fixture-key/)
  assert.equal(repository.resolveModelCredential('channel-a')?.apiKey, 'top-secret-fixture-key')
  assert.equal(repository.listModelCredentialStatus()[0]?.upstreamOrigin, 'https://relay.example')
})

test('model gateway rejects insecure and private upstream addresses', async () => {
  const { normalizeModelBaseUrl } = await import('../../src/server/data/repositories/model-credentials')
  assert.throws(() => normalizeModelBaseUrl('http://relay.example', 'anthropic'), /HTTPS/)
  assert.throws(() => normalizeModelBaseUrl('https://127.0.0.1/v1', 'openai-compatible'), /内网/)
  assert.throws(() => normalizeModelBaseUrl('https://169.254.169.254/latest', 'anthropic'), /内网/)
  assert.equal(normalizeModelBaseUrl('https://api.example.test/v1/', 'openai-compatible'), 'https://api.example.test/v1')
  const repository = await import('../../src/server/data/repositories/model-credentials')
  assert.throws(() => repository.upsertModelCredential({ id: 'redacted', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '[REDACTED]' }), /脱敏占位符/)
})

test('sync config migrates legacy credentials and never returns plaintext secrets or upstream paths', async () => {
  const { sanitizeChatConfig } = await import('../../src/server/chat/credentials')
  const safe = sanitizeChatConfig({
    activeProfileId: 'legacy-channel',
    apiProfiles: [{ id: 'legacy-channel', name: 'Legacy', provider: 'anthropic', baseUrl: 'https://relay.example/secret-path', apiKey: 'legacy-secret-key', defaultModel: 'claude-fixture', models: [] }],
  })
  assert.equal(safe.apiProfiles[0].credentialConfigured, true)
  assert.equal(safe.apiProfiles[0].upstreamOrigin, 'https://relay.example')
  assert.equal('apiKey' in safe.apiProfiles[0], false)
  assert.equal('baseUrl' in safe.apiProfiles[0], false)
  assert.doesNotMatch(JSON.stringify(safe), /legacy-secret-key|secret-path/)
})

test('durable sync manifest strips legacy secrets before saving or returning config', async () => {
  const sync = await import('../../src/server/chat-sync')
  const merged = sync.mergeSyncDelta({
    sessions: [], tombstones: {}, configUpdatedAt: 100,
    config: { activeProfileId: 'sync-channel', apiProfiles: [{ id: 'sync-channel', name: 'Sync', provider: 'anthropic', baseUrl: 'https://sync-relay.example/private-v1', apiKey: 'sync-plaintext-secret', defaultModel: 'fixture', models: [] }] },
  })
  assert.doesNotMatch(JSON.stringify(merged.config), /sync-plaintext-secret|private-v1/)
  const manifest = readFileSync(path.join(testDataDir, 'chat', 'manifest.json'), 'utf8')
  assert.doesNotMatch(manifest, /sync-plaintext-secret|private-v1/)
  assert.equal(sync.loadSyncManifest().config?.apiProfiles?.[0]?.credentialConfigured, true)
})

test('browser store upgrade stages old credentials in memory and rewrites local state without them', async () => {
  const store = await import('../../src/lib/chatStore')
  const migrate = store.useChatStore.persist.getOptions().migrate!
  const migrated: any = await migrate({ settings: {
    apiProfiles: [{ id: 'browser-legacy', name: 'Browser legacy', provider: 'anthropic', baseUrl: 'https://browser-relay.example/private', apiKey: 'browser-plaintext-key', defaultModel: 'fixture', models: [] }],
    activeProfileId: 'browser-legacy', model: 'fixture', sessions: [],
  } }, 9)
  assert.equal('apiKey' in migrated.settings.apiProfiles[0], false)
  assert.equal('baseUrl' in migrated.settings.apiProfiles[0], false)
  assert.deepEqual(store.getPendingLegacyModelCredentials().map(item => item.id), ['browser-legacy'])
  const extracted = store.extractConfig({ ...migrated.settings, apiProfiles: [{ ...migrated.settings.apiProfiles[0], apiKey: 'injected', baseUrl: 'https://injected.example' }] } as any)
  assert.doesNotMatch(JSON.stringify(extracted), /injected/)
  store.completeLegacyModelCredentialMigration(['browser-legacy'])
})

test('credential status API never echoes API keys', async () => {
  const { NextRequest } = await import('next/server')
  const route = await import('../../src/app/api/model-profiles/route')
  const response = await route.POST(new NextRequest('http://localhost/api/model-profiles', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'channel-b', provider: 'openai-compatible', baseUrl: 'https://openai-relay.example/v1', apiKey: 'never-echo-this-key' }),
  }))
  assert.equal(response.status, 200)
  assert.doesNotMatch(await response.text(), /never-echo-this-key/)
  assert.doesNotMatch(await (await route.GET()).text(), /never-echo-this-key/)
})

test('chat rejects legacy browser-supplied credentials before contacting upstream', async () => {
  const { NextRequest } = await import('next/server')
  const route = await import('../../src/app/api/chat/route')
  const response = await route.POST(new NextRequest('http://localhost/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [], api_profile: { profileId: 'channel-a', baseUrl: 'https://evil.example', apiKey: 'stolen' } }),
  }))
  assert.equal(response.status, 400)
  assert.match(await response.text(), /不能再提交/)
})

test('chat rejects an unconfigured CC route instead of silently falling back', async () => {
  const { NextRequest } = await import('next/server')
  const route = await import('../../src/app/api/chat/route')
  const response = await route.POST(new NextRequest('http://localhost/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ generation_route: 'claude-code', messages: [] }),
  }))
  assert.equal(response.status, 503)
  assert.match(await response.text(), /不会自动改走 API/)
})

test('registered legacy request shape uses the server copy of the credential during rollout', async () => {
  const { NextRequest } = await import('next/server')
  const repository = await import('../../src/server/data/repositories/model-credentials')
  const route = await import('../../src/app/api/chat/route')
  repository.upsertModelCredential({ id: 'legacy-compatible', provider: 'anthropic', baseUrl: 'https://1.1.1.1', apiKey: 'trusted-server-copy' })
  const oldFetch = globalThis.fetch
  let sentKey = ''
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('https://wttr.in/')) return new Response('', { status: 503 })
    sentKey = String((init?.headers as Record<string, string>)?.['x-api-key'] || '')
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'compat' }], stop_reason: 'end_turn', usage: {} }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const response = await route.POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'legacy' }], model: 'fixture', api_profile: { provider: 'anthropic', baseUrl: 'https://1.1.1.1', apiKey: 'untrusted-browser-copy' } }),
    }))
    assert.equal(response.status, 200)
    assert.equal(sentKey, 'trusted-server-copy')
  } finally { globalThis.fetch = oldFetch }
})

test('OpenAI-compatible adapter preserves images, tools, streaming events, usage, and server-only auth', async () => {
  const { NextRequest } = await import('next/server')
  const repository = await import('../../src/server/data/repositories/model-credentials')
  const route = await import('../../src/app/api/chat/route')
  repository.upsertModelCredential({ id: 'openai-channel', provider: 'openai-compatible', baseUrl: 'https://1.1.1.1', apiKey: 'server-only-openai-key' })

  const oldFetch = globalThis.fetch
  let turn = 0
  let firstBody: any = null
  let authHeader = ''
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.startsWith('https://wttr.in/')) return new Response('', { status: 503 })
    assert.equal(url, 'https://1.1.1.1/v1/chat/completions')
    authHeader = String((init?.headers as Record<string, string>)?.Authorization || '')
    const body = JSON.parse(String(init?.body || '{}'))
    if (body.stream) {
      const sse = [
        'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}',
        'data: {"choices":[{"delta":{"content":"stream-openai"},"finish_reason":"stop"}]}',
        'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":3}}}',
        'data: [DONE]', '',
      ].join('\n')
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    turn++
    if (turn === 1) {
      firstBody = body
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'read_notes', arguments: '{}' } }] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 5, completion_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    assert.equal(body.messages.some((message: any) => message.role === 'tool' && message.tool_call_id === 'call-1'), true)
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'openai done' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  try {
    const nonStream = await route.POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'look', images: ['https://images.example/photo.jpg'] }], model: 'fixture-model', api_profile: { profileId: 'openai-channel' }, tools_enabled: true, stream: false }),
    }))
    assert.equal(nonStream.status, 200)
    const json = await nonStream.json()
    assert.equal(json.content, 'openai done')
    assert.equal(json.input_tokens, 9)
    assert.equal(json.tool_calls[0].name, 'read_notes')
    assert.equal(firstBody.messages.some((message: any) => Array.isArray(message.content) && message.content.some((part: any) => part.type === 'image_url')), true)
    assert.equal(firstBody.tools.some((tool: any) => tool.function?.name === 'read_notes'), true)
    assert.equal(authHeader, 'Bearer server-only-openai-key')

    const stream = await route.POST(new NextRequest('http://localhost/api/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'stream' }], model: 'fixture-model', api_profile: { profileId: 'openai-channel' }, tools_enabled: false, stream: true }),
    }))
    const streamText = await stream.text()
    assert.match(streamText, /"type":"thinking"/)
    assert.match(streamText, /stream-openai/)
    assert.match(streamText, /"input_tokens":7/)
    assert.match(streamText, /\[DONE\]/)
  } finally { globalThis.fetch = oldFetch }
})

test('gateway retries a transient 429 before accepting an upstream body', async () => {
  const { fetchUpstreamWithRetry } = await import('../../src/server/chat/request')
  const oldFetch = globalThis.fetch
  let attempts = 0
  globalThis.fetch = async () => {
    attempts++
    return attempts === 1
      ? new Response('busy', { status: 429, headers: { 'retry-after': '0' } })
      : new Response('ok', { status: 200 })
  }
  try {
    const response = await fetchUpstreamWithRetry('https://1.1.1.1/v1/messages', { method: 'POST' }, { provider: 'anthropic', model: 'fixture' })
    assert.equal(response.status, 200)
    assert.equal(attempts, 2)
  } finally { globalThis.fetch = oldFetch }
})

test('summary endpoint resolves its channel on the server and never needs a browser key', async () => {
  const { NextRequest } = await import('next/server')
  const repository = await import('../../src/server/data/repositories/model-credentials')
  const summary = await import('../../src/app/api/chat/summary/route')
  repository.upsertModelCredential({ id: 'summary-channel', provider: 'openai-compatible', baseUrl: 'https://1.1.1.1', apiKey: 'summary-server-key' })
  const oldFetch = globalThis.fetch
  let authorization = ''
  globalThis.fetch = async (_input, init) => {
    authorization = String((init?.headers as Record<string, string>)?.Authorization || '')
    return new Response(JSON.stringify({ choices: [{ message: { content: 'summary fixture' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    const response = await summary.POST(new NextRequest('http://localhost/api/chat/summary', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello', timestamp: Date.now() }], model: 'fixture-model', api_profile: { profileId: 'summary-channel', modelId: 'fixture-model' } }),
    }))
    assert.equal(response.status, 200)
    assert.equal((await response.json()).content, 'summary fixture')
    assert.equal(authorization, 'Bearer summary-server-key')
  } finally { globalThis.fetch = oldFetch }
})

test('both gateways receive the reply mode prompt and a reasoning-safe short budget', async () => {
  const { NextRequest } = await import('next/server')
  const repository = await import('../../src/server/data/repositories/model-credentials')
  const route = await import('../../src/app/api/chat/route')
  const oldFetch = globalThis.fetch
  let bodies: any[] = []
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || '{}')); bodies.push(body)
    return new Response(JSON.stringify(body.system
      ? { content: [{ type: 'text', text: '一\n<!--split-->\n二' }], stop_reason: 'end_turn', usage: { input_tokens: 2, output_tokens: 2 } }
      : { choices: [{ message: { role: 'assistant', content: '一\n<!--split-->\n二' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  try {
    for (const provider of ['anthropic', 'openai-compatible'] as const) {
      const id = `reply-mode-${provider}`
      repository.upsertModelCredential({ id, provider, baseUrl: 'https://1.1.1.1', apiKey: 'test-only-mode-key' })
      for (const mode of ['short', 'long']) {
        const response = await route.POST(new NextRequest('http://localhost/api/chat', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: '今天想你了' }], system: '保留这份人设', api_profile: { profileId: id }, model: 'fixture', thinking_budget: 8000, tools_enabled: false, stream: false, reply_mode: mode }),
        }))
        assert.equal(response.status, 200)
        const body = bodies.at(-1)
        assert.match(JSON.stringify(body.system || body.messages[0]), /保留这份人设/)
        assert.match(JSON.stringify(body.system || body.messages[0]), mode === 'short' ? /短聊模式/ : /长聊模式/)
        assert.equal(body.max_tokens, mode === 'short' ? 10048 : 16000)
        assert.ok(body.max_tokens > 8000)
      }
    }
  } finally { globalThis.fetch = oldFetch }
})
