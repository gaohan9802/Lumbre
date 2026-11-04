import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-engawa-'))
process.env.DATA_DIR = root

let engawa: typeof import('../../src/server/engawa')
let history: typeof import('../../src/server/engawa-history-store')
let unread: typeof import('../../src/server/room-unread-store')
let art: typeof import('../../src/server/engawa-art')
const originalFetch = globalThis.fetch

before(async () => {
  engawa = await import('../../src/server/engawa')
  history = await import('../../src/server/engawa-history-store')
  unread = await import('../../src/server/room-unread-store')
  art = await import('../../src/server/engawa-art')
})

test('a daily card first found by star creates one room unread only once', async () => {
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), { headers: { 'mcp-session-id': 'fixture-session' } })
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, title: '今天的一幅画' }) }] } }))
  }
  unread.markRoomRead('engawa')
  await engawa.executeEngawaTool('daily_art', {}, true)
  await engawa.executeEngawaTool('daily_art', {}, true)
  assert.equal(unread.readRoomUnreadCounts().engawa, 1)
})
after(() => { globalThis.fetch = originalFetch; rmSync(root, { recursive: true, force: true }) })

test('Engawa stays on the fixed internal MCP endpoint and archives daily results', async () => {
  const calls: Array<{ url: string; method: string; session: string | null }> = []
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body))
    calls.push({ url: String(input), method: body.method, session: new Headers(init?.headers).get('mcp-session-id') })
    if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'engawa', version: '0.2.0' } } }), { headers: { 'mcp-session-id': 'fixture-session' } })
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, sentence: '星垂平野阔。' }) }] } })}\n\n`)
  }

  assert.match(await engawa.executeEngawaTool('daily_poem', {}), /星垂平野阔/)
  assert.deepEqual(calls.map(call => call.method), ['initialize', 'notifications/initialized', 'tools/call'])
  assert.equal(calls.every(call => call.url === 'http://engawa:8799/mcp'), true)
  assert.equal(calls[1].session, 'fixture-session')
  assert.equal(calls[2].session, 'fixture-session')
  const archived = history.readEngawaHistory()
  assert.equal(archived.day.daily_poem?.result.sentence, '星垂平野阔。')
})

test('Engawa rejects unknown tools before making a request', async () => {
  let fetched = false
  globalThis.fetch = async () => { fetched = true; return new Response('{}') }
  await assert.rejects(() => engawa.executeEngawaTool('not_a_tool', {}), /未知/)
  assert.equal(fetched, false)
})

test('windowsill lines stay within forty characters and survive later daily captures', () => {
  assert.throws(() => history.writeEngawaLine('豹'.repeat(41)), /四十字/)
  const line = history.writeEngawaLine('今天的月亮像一小片没吃完的梨。')
  history.archiveEngawaResult('daily_poem', {}, JSON.stringify({ ok: true, sentence: '今夜偏知春气暖。' }))
  assert.equal(history.readEngawaHistory().line?.text, line.text)
})

test('daily art proxy only accepts the archive provider host', () => {
  assert.equal(art.isAllowedEngawaArtUrl('https://openaccess-cdn.clevelandart.org/x/art.jpg'), true)
  assert.equal(art.isAllowedEngawaArtUrl('https://openaccess-cdn.clevelandart.org.example.com/art.jpg'), false)
  assert.equal(art.isAllowedEngawaArtUrl('http://openaccess-cdn.clevelandart.org/art.jpg'), false)
})
