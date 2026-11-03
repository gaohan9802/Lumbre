import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import { executeCedarToyTool } from '../../src/server/cedartoy'

const originalFetch = globalThis.fetch
const originalUrl = process.env.LUMBRE_CEDARTOY_MCP_URL

beforeEach(() => { delete process.env.LUMBRE_CEDARTOY_MCP_URL })
afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalUrl === undefined) delete process.env.LUMBRE_CEDARTOY_MCP_URL
  else process.env.LUMBRE_CEDARTOY_MCP_URL = originalUrl
})

test('public catalog calls stay on the fixed CedarToy host', async () => {
  const calls: Array<{ url: string; body: any }> = []
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) })
    const result = calls.length === 1
      ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'cedartoy', version: '1' } }
      : { content: [{ type: 'text', text: '[{"name":"eco"}]' }] }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 'fixture', result }), { headers: { 'content-type': 'application/json' } })
  }

  assert.equal(await executeCedarToyTool('cedar_list_games', {}), '[{"name":"eco"}]')
  assert.deepEqual(calls.map(call => call.url), ['https://toy.cedarstar.org/', 'https://toy.cedarstar.org/'])
  assert.deepEqual(calls.map(call => call.body.method), ['initialize', 'tools/call'])
  assert.equal(calls[1].body.params.name, 'list_games')
})

test('stateful play requires a configured private endpoint and rejects impostor hosts', async () => {
  await assert.rejects(() => executeCedarToyTool('cedar_play', { game: 'eco', action: 'status' }), /尚未绑定/)
  process.env.LUMBRE_CEDARTOY_MCP_URL = 'https://example.com/not-a-token'
  await assert.rejects(() => executeCedarToyTool('cedar_list_games', {}), /toy\.cedarstar\.org/)
})

test('account tool blocks credential operations before any network request', async () => {
  let fetched = false
  globalThis.fetch = async () => { fetched = true; return new Response('{}') }
  process.env.LUMBRE_CEDARTOY_MCP_URL = 'https://toy.cedarstar.org/fixture_token_1234'
  await assert.rejects(() => executeCedarToyTool('cedar_account', { action: 'login_or_register', username: 'x', password: 'secret' }), /没有开放/)
  assert.equal(fetched, false)
})

test('configured play uses the private endpoint without returning it', async () => {
  process.env.LUMBRE_CEDARTOY_MCP_URL = 'https://toy.cedarstar.org/fixture_token_1234'
  const urls: string[] = []
  globalThis.fetch = async (input) => {
    urls.push(String(input))
    const result = urls.length === 1
      ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'cedartoy', version: '1' } }
      : { content: [{ type: 'text', text: '回合完成' }] }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 'fixture', result }))
  }
  assert.equal(await executeCedarToyTool('cedar_play', { game: 'eco', action: 'status' }), '回合完成')
  assert.equal(urls.every(url => url.endsWith('/fixture_token_1234')), true)
})

test('confirmed save deletion supplies CedarToy its required confirmation flag', async () => {
  process.env.LUMBRE_CEDARTOY_MCP_URL = 'https://toy.cedarstar.org/fixture_token_1234'
  const bodies: any[] = []
  globalThis.fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)))
    const result = bodies.length === 1
      ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'cedartoy', version: '1' } }
      : { content: [{ type: 'text', text: '已删除' }] }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 'fixture', result }))
  }
  await executeCedarToyTool('cedar_account', { action: 'delete_save', game: 'eco', slot: 1 })
  assert.equal(bodies[1].params.arguments.confirm, true)
})
