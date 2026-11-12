import assert from 'node:assert/strict'
import test, { afterEach, beforeEach } from 'node:test'
import { executeKitchenetteTool, kitchenetteBrowserConfig } from '../../src/server/kitchenette'
import { KITCHEN_TOOL_DEFINITIONS } from '../../src/server/agent/definitions/kitchen'

const originalFetch = globalThis.fetch
const originalEnv = {
  url: process.env.LUMBRE_KITCHENETTE_URL,
  publicUrl: process.env.LUMBRE_KITCHENETTE_PUBLIC_URL,
  token: process.env.LUMBRE_KITCHENETTE_TOKEN,
  who: process.env.LUMBRE_KITCHENETTE_WHO,
  insecure: process.env.LUMBRE_KITCHENETTE_ALLOW_INSECURE_HTTP,
}

beforeEach(() => {
  process.env.LUMBRE_KITCHENETTE_URL = 'https://kitchen.internal.example'
  process.env.LUMBRE_KITCHENETTE_PUBLIC_URL = 'https://kitchen.example.com'
  process.env.LUMBRE_KITCHENETTE_TOKEN = 'fixture-kitchen-token-at-least-32-characters'
  process.env.LUMBRE_KITCHENETTE_WHO = '星星'
  delete process.env.LUMBRE_KITCHENETTE_ALLOW_INSECURE_HTTP
})

afterEach(() => {
  globalThis.fetch = originalFetch
  for (const [key, value] of Object.entries(originalEnv)) {
    const name = key === 'url' ? 'LUMBRE_KITCHENETTE_URL'
      : key === 'publicUrl' ? 'LUMBRE_KITCHENETTE_PUBLIC_URL'
        : key === 'token' ? 'LUMBRE_KITCHENETTE_TOKEN'
          : key === 'who' ? 'LUMBRE_KITCHENETTE_WHO'
            : 'LUMBRE_KITCHENETTE_ALLOW_INSECURE_HTTP'
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

test('kitchen calls the fixed MCP endpoint with one authenticated session and role', async () => {
  const calls: Array<{ url: string; body: any; authorization: string | null; session: string | null }> = []
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body))
    const headers = new Headers(init?.headers)
    calls.push({ url: String(input), body, authorization: headers.get('authorization'), session: headers.get('mcp-session-id') })
    if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), { headers: { 'mcp-session-id': 'kitchen-session' } })
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    return new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '开火了' }] } })}\n\n`)
  }

  assert.equal(await executeKitchenetteTool('kitchen_cook', { dish: '番茄蛋', minutes: 10, ingredients: ['番茄', '蛋'] }), '开火了')
  assert.deepEqual(calls.map(call => call.body.method), ['initialize', 'notifications/initialized', 'tools/call'])
  assert.equal(calls.every(call => call.url === 'https://kitchen.internal.example/mcp'), true)
  assert.equal(calls.every(call => call.authorization === 'Bearer fixture-kitchen-token-at-least-32-characters'), true)
  assert.equal(calls[1].session, 'kitchen-session')
  assert.equal(calls[2].session, 'kitchen-session')
  assert.equal(calls[2].body.params.arguments.who, '星星')
})

test('cooking methods match the pinned kitchen protocol', () => {
  const cook = KITCHEN_TOOL_DEFINITIONS.find(tool => tool.name === 'kitchen_cook')!
  assert.deepEqual((cook.input_schema.properties.method as { enum: string[] }).enum, ['炒', '煎', '炸', '煮', '蒸', '烤', '拌'])
})

test('browser config reveals only the public endpoint and credential to the authenticated UI', () => {
  assert.deepEqual(kitchenetteBrowserConfig(), {
    pageUrl: 'https://kitchen.example.com',
    credential: 'fixture-kitchen-token-at-least-32-characters',
    who: '星星',
  })
})

test('kitchen rejects unknown tools and insecure public endpoints before fetch', async () => {
  let fetched = false
  globalThis.fetch = async () => { fetched = true; return new Response('{}') }
  await assert.rejects(() => executeKitchenetteTool('not-a-kitchen-tool', {}), /未知/)
  process.env.LUMBRE_KITCHENETTE_PUBLIC_URL = 'http://kitchen.example.com'
  process.env.LUMBRE_KITCHENETTE_ALLOW_INSECURE_HTTP = '1'
  assert.throws(() => kitchenetteBrowserConfig(), /HTTPS/)
  assert.equal(fetched, false)
})

test('kitchen surfaces upstream tool failures', async () => {
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body))
    if (body.method === 'initialize') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: {} }), { headers: { 'mcp-session-id': 'kitchen-session' } })
    if (body.method === 'notifications/initialized') return new Response(null, { status: 202 })
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { isError: true, content: [{ type: 'text', text: '食材不在冰箱里' }] } }))
  }
  await assert.rejects(() => executeKitchenetteTool('eat', { meal: '月亮' }), /食材不在冰箱里/)
})
