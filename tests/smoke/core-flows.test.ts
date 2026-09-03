import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const testDataDir = mkdtempSync(path.join(tmpdir(), 'lumbre-stage0-'))
assert.notEqual(path.resolve(testDataDir), '/persistent')
process.env.DATA_DIR = testDataDir
process.env.LUMBRE_ACCESS_PASSWORD = 'stage-zero-test-password'
process.env.LUMBRE_INTERNAL_SECRET = 'stage-zero-internal-secret'

after(() => rmSync(testDataDir, { recursive: true, force: true }))

test('login creates a session and logout clears it', async () => {
  const { NextRequest } = await import('next/server')
  const login = await import('../../src/app/api/auth/login/route')
  const logout = await import('../../src/app/api/auth/logout/route')
  const request = new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': 'stage0-test' },
    body: JSON.stringify({ password: 'stage-zero-test-password', next: '/' }),
  })
  const loginResponse = await login.POST(request)
  assert.equal(loginResponse.status, 200)
  assert.match(loginResponse.headers.get('set-cookie') || '', /lumbre_session=/)
  const logoutResponse = await logout.POST()
  assert.equal(logoutResponse.status, 200)
  assert.match(logoutResponse.headers.get('set-cookie') || '', /Max-Age=0/i)
})

test('diary can be created, read and updated using isolated data', async () => {
  const diary = await import('../../src/server/diary-store')
  const entry = diary.writeDiary({
    date: '2026-09-02', author: 'fire', title: 'fixture title', content: 'fixture body',
    visibility: 'public', tags: 'stage0 smoke',
  })
  assert.equal(diary.readDiaries('fire', { target_date: '2026-09-02' })[0]?.content, 'fixture body')
  assert.equal(diary.updateDiary(entry.date, entry.author, 'updated body', entry.time_id), 'ok')
  assert.match(diary.readDiaries('fire', { target_date: entry.date })[0]?.content || '', /updated body/)
})

test('photo can be uploaded and listed using isolated data', async () => {
  const photos = await import('../../src/server/photo-store')
  const photo = photos.writePhoto({ author: 'fire', url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', caption: 'fixture' })
  assert.equal(photos.getPhoto(photo.id)?.caption, 'fixture')
  assert.equal(photos.listPhotos().some(item => item.id === photo.id), true)
})

test('todo can be created, completed and edited using isolated data', async () => {
  const todo = await import('../../src/server/todo-store')
  const item = todo.addTodo('fixture todo', 'fire', '2026-09-02')
  assert.equal(todo.toggleTodo(item.id, '2026-09-02'), 'ok')
  assert.equal(todo.editTodo(item.id, 'fixture todo updated', '2026-09-02'), 'ok')
  const saved = todo.getTodos('2026-09-02').items.find(value => value.id === item.id)
  assert.equal(saved?.done, true)
  assert.equal(saved?.text, 'fixture todo updated')
})

test('memory can be written and read using isolated data', async () => {
  const brain = await import('../../src/server/brain')
  const now = new Date().toISOString()
  const id = 'f17e00000001'
  brain.saveBucket({
    id,
    metadata: {
      id, name: 'fixture memory', type: 'dynamic', domain: ['test'], tags: ['stage0'],
      valence: 0.5, arousal: 0.5, importance: 5, resolved: false, pinned: false, digested: false,
      created: now, last_active: now, activation_count: 1,
    },
    content: 'fixture memory body', score: 0,
  })
  assert.equal(brain.getBucket(id)?.content, 'fixture memory body')
  assert.equal(brain.searchBuckets('fixture memory').some(bucket => bucket.id === id), true)
})

test('two-device chat sync merges messages and retry is idempotent', async () => {
  const sync = await import('../../src/server/chat-sync')
  const base = { id: 'm1', role: 'user', content: 'from phone', timestamp: 1000 }
  assert.equal(sync.upsertSyncSessionMessage('fixture-session', base, { title: 'fixture', createdAt: 1000 }).appended, true)
  assert.equal(sync.upsertSyncSessionMessage('fixture-session', base, { title: 'fixture', createdAt: 1000 }).appended, false)
  sync.mergeSyncDelta({
    sessions: [{
      id: 'fixture-session', title: 'fixture', createdAt: 1000, updatedAt: Date.now() + 1000,
      messages: [base, { id: 'm2', role: 'assistant', content: 'from desktop', timestamp: 2000 }],
    }],
    tombstones: {},
  })
  const saved = sync.loadSyncSessions(['fixture-session'])[0]
  assert.deepEqual(saved.messages.map((message: any) => message.id), ['m1', 'm2'])
})

test('chat supports non-streaming and streaming response contracts without real network', async () => {
  const { NextRequest } = await import('next/server')
  const chat = await import('../../src/app/api/chat/route')
  const oldFetch = globalThis.fetch
  let upstreamTools: string[] = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    if (url.startsWith('https://wttr.in/')) return new Response('', { status: 503 })
    if (url.includes('/v1/messages')) {
      const requestBody = JSON.parse(String(init?.body || '{}'))
      upstreamTools = (requestBody.tools || []).map((tool: any) => tool.name)
      return new Response(JSON.stringify({
        content: [{ type: 'text', text: 'fixture reply' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 2, output_tokens: 3 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    throw new Error(`unexpected URL: ${url}`)
  }
  try {
    const request = new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lumbre-internal': 'stage-zero-internal-secret' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'fixture hello' }],
        api_profile: { provider: 'anthropic', apiKey: 'fixture-key', baseUrl: 'https://mock.invalid' },
        tools_enabled: true,
        stream: false,
        _wake: true,
      }),
    })
    const response = await chat.POST(request)
    assert.equal(response.status, 200)
    assert.equal((await response.json()).content, 'fixture reply')
    assert.equal(upstreamTools.includes('read_diary'), true)
    for (const blocked of ['delete_diary', 'remove_todo', 'send_email', 'reply_email', 'galatea']) {
      assert.equal(upstreamTools.includes(blocked), false)
    }

    const forgedRequest = new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lumbre-internal': 'wrong-secret' },
      body: JSON.stringify({ messages: [], _wake: true }),
    })
    assert.equal((await chat.POST(forgedRequest)).status, 403)

    const { executeTool } = await import('../../src/server/tools')
    assert.match(
      await executeTool('send_email', { to: 'nobody@example.invalid', subject: 'fixture', body: 'fixture' }, { unattendedWake: true }),
      /Tool denied/,
    )

    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url.startsWith('https://wttr.in/')) return new Response('', { status: 503 })
      const sse = [
        'data: {"type":"message_start","message":{"usage":{"input_tokens":2}}}',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"stream fixture"}}',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":3}}',
        '',
      ].join('\n')
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }
    const streamingRequest = new NextRequest('http://localhost/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lumbre-internal': 'stage-zero-internal-secret' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'fixture hello' }],
        api_profile: { provider: 'anthropic', apiKey: 'fixture-key', baseUrl: 'https://mock.invalid' },
        tools_enabled: false,
        stream: true,
        _wake: true,
      }),
    })
    const streamingResponse = await chat.POST(streamingRequest)
    const body = await streamingResponse.text()
    assert.match(body, /stream fixture/)
    assert.match(body, /\[DONE\]/)
  } finally {
    globalThis.fetch = oldFetch
  }
})

test('all test writes stayed outside production persistent storage', () => {
  assert.equal(path.resolve(process.env.DATA_DIR || ''), path.resolve(testDataDir))
  assert.doesNotThrow(() => JSON.parse(readFileSync(path.join(testDataDir, 'chat', 'manifest.json'), 'utf8')))
})
