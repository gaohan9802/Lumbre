import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-tool-bridge-'))
const secret = 'cc-tool-bridge-fixture-secret-000000000'
process.env.DATA_DIR = root
process.env.LUMBRE_AUTH_SECRET = 'cc-tool-confirmation-fixture-secret'
process.env.LUMBRE_CC_TOOL_BRIDGE_SECRET = secret

let NextRequest: typeof import('next/server').NextRequest
let route: typeof import('../../src/app/api/internal/cc-tools/route')
let notes: typeof import('../../src/server/diary-store')

before(async () => {
  ;({ NextRequest } = await import('next/server'))
  route = await import('../../src/app/api/internal/cc-tools/route')
  notes = await import('../../src/server/diary-store')
})
after(() => rmSync(root, { recursive: true, force: true }))

function authHeaders(extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${secret}`, ...extra }
}

test('internal bridge exposes only registered Lumbre chat tools behind its own secret', async () => {
  const unauthorized = await route.GET(new NextRequest('http://lumbre.test/api/internal/cc-tools?session_id=conversation-1'))
  assert.equal(unauthorized.status, 401)

  const response = await route.GET(new NextRequest('http://lumbre.test/api/internal/cc-tools?session_id=conversation-1', {
    headers: authHeaders(),
  }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.json()
  assert.equal(body.tools.length, 66)
  assert.equal(body.tools.some((tool: any) => ['Bash', 'Shell', 'Read', 'Write', 'Edit'].includes(tool.name)), false)
  assert.equal(body.tools.some((tool: any) => tool.name === 'read_diary'), true)
})

test('bridge reuses Lumbre policy, hides confirmation tokens from Claude and keeps them for the UI', async () => {
  const note = notes.writeNote('star', 'CC bridge red confirmation fixture')
  const response = await route.POST(new NextRequest('http://lumbre.test/api/internal/cc-tools', {
    method: 'POST',
    headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({
      session_id: 'conversation-1',
      name: 'delete_note',
      input: { note_id: note.id, author: 'star' },
    }),
  }))
  assert.equal(response.status, 200)
  const body = await response.json()
  const pending = JSON.parse(body.result)
  assert.equal(pending.code, 'CONFIRMATION_REQUIRED')
  assert.equal(typeof pending.confirmation.token, 'string')
  assert.doesNotMatch(JSON.stringify(body.content), new RegExp(pending.confirmation.token))
  assert.equal(notes.listNotes().some(item => item.id === note.id), true)
})

test('unattended CC wakes keep the existing restricted wake tool policy', async () => {
  const listed = await route.GET(new NextRequest('http://lumbre.test/api/internal/cc-tools?session_id=conversation-1&source=unattended-wake', { headers: authHeaders() }))
  const tools = (await listed.json()).tools
  assert.equal(tools.some((tool: any) => tool.name === 'wake_me'), true)
  assert.equal(tools.some((tool: any) => tool.name === 'delete_note'), false)

  const note = notes.writeNote('star', 'unattended delete fixture')
  const denied = await route.POST(new NextRequest('http://lumbre.test/api/internal/cc-tools', {
    method: 'POST', headers: authHeaders({ 'content-type': 'application/json' }),
    body: JSON.stringify({ session_id: 'conversation-1', source: 'unattended-wake', name: 'delete_note', input: { note_id: note.id, author: 'star' } }),
  }))
  assert.match((await denied.json()).result, /Unattended wake is not allowed|Tool denied/)
  assert.equal(notes.listNotes().some(item => item.id === note.id), true)
})

test('stdio MCP forwards typed calls, records a redacted UI event and enforces its fixed server', async () => {
  const eventFile = path.join(root, 'mcp-events.jsonl')
  const requestsFile = path.join(root, 'mcp-requests.jsonl')
  const fetchFixture = path.join(root, 'mcp-fetch-fixture.mjs')
  writeFileSync(fetchFixture, `import fs from 'node:fs'
globalThis.fetch = async (url, init = {}) => {
  if (init.headers?.authorization !== 'Bearer ${secret}') throw new Error('bad auth')
  fs.appendFileSync('${requestsFile}', JSON.stringify({ method: init.method || 'GET', url: String(url), body: init.body ? JSON.parse(init.body) : null }) + '\\n')
  if (!init.method || init.method === 'GET') return Response.json({ tools: [{ name: 'fixture_tool', description: 'fixture', inputSchema: { type: 'object', properties: { password: { type: 'string' } } } }] })
  return Response.json({ name: 'fixture_tool', result: '{"ok":true}', content: [{ type: 'text', text: 'done' }], isError: false })
}
`)
  const child = spawn(process.execPath, [path.join(process.cwd(), 'services/cc-gateway/lumbre-mcp-server.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_OPTIONS: `--import=${fetchFixture}`,
      LUMBRE_CC_TOOL_BRIDGE_URL: 'https://lumbre.test/api/internal/cc-tools',
      LUMBRE_CC_TOOL_BRIDGE_SECRET: secret,
      LUMBRE_CC_CONVERSATION_ID: 'conversation-1',
      LUMBRE_CC_TOOL_EVENT_FILE: eventFile,
      LUMBRE_CC_MAX_TOOL_CALLS: '2',
      LUMBRE_CC_TOOL_SOURCE: 'unattended-wake',
    },
  })
  const output = readline.createInterface({ input: child.stdout })
  const pending: Array<(value: any) => void> = []
  output.on('line', line => pending.shift()?.(JSON.parse(line)))
  const call = (message: any) => new Promise<any>(resolve => {
    pending.push(resolve)
    child.stdin.write(`${JSON.stringify(message)}\n`)
  })
  try {
    const initialized = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    assert.equal(initialized.result.serverInfo.name, 'lumbre')
    const listed = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    assert.deepEqual(listed.result.tools.map((tool: any) => tool.name), ['fixture_tool'])
    const executed = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fixture_tool', arguments: { password: 'never-store-me' } } })
    assert.equal(executed.result.content[0].text, 'done')
    const event = JSON.parse(readFileSync(eventFile, 'utf8').trim())
    assert.equal(event.input.password, '[redacted]')
    assert.doesNotMatch(JSON.stringify(event), /never-store-me/)
    const requests = readFileSync(requestsFile, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    assert.equal(requests[1].body.session_id, 'conversation-1')
    assert.match(requests[0].url, /source=unattended-wake/)
    assert.equal(requests[1].body.source, 'unattended-wake')
  } finally {
    child.stdin.end()
    child.kill('SIGTERM')
  }
})

test('silent cache warm exposes the same tool list but denies every tool call locally', async () => {
  const eventFile = path.join(root, 'warm-mcp-events.jsonl')
  const requestsFile = path.join(root, 'warm-mcp-requests.jsonl')
  const fetchFixture = path.join(root, 'warm-mcp-fetch-fixture.mjs')
  writeFileSync(fetchFixture, `import fs from 'node:fs'
globalThis.fetch = async (url, init = {}) => {
  fs.appendFileSync('${requestsFile}', JSON.stringify({ method: init.method || 'GET', url: String(url) }) + '\\n')
  if (init.method === 'POST') throw new Error('cache warm must not call tools')
  return Response.json({ tools: [{ name: 'fixture_tool', description: 'fixture', inputSchema: { type: 'object', properties: {} } }] })
}
`)
  const child = spawn(process.execPath, [path.join(process.cwd(), 'services/cc-gateway/lumbre-mcp-server.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_OPTIONS: `--import=${fetchFixture}`,
      LUMBRE_CC_TOOL_BRIDGE_URL: 'https://lumbre.test/api/internal/cc-tools',
      LUMBRE_CC_TOOL_BRIDGE_SECRET: secret,
      LUMBRE_CC_CONVERSATION_ID: 'conversation-1',
      LUMBRE_CC_TOOL_EVENT_FILE: eventFile,
      LUMBRE_CC_CACHE_WARM: '1',
    },
  })
  const output = readline.createInterface({ input: child.stdout })
  const pending: Array<(value: any) => void> = []
  output.on('line', line => pending.shift()?.(JSON.parse(line)))
  const call = (message: any) => new Promise<any>(resolve => {
    pending.push(resolve)
    child.stdin.write(`${JSON.stringify(message)}\n`)
  })
  try {
    await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })
    const listed = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    assert.deepEqual(listed.result.tools.map((tool: any) => tool.name), ['fixture_tool'])
    const denied = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fixture_tool', arguments: {} } })
    assert.equal(denied.result.isError, true)
    assert.match(denied.result.content[0].text, /denied during silent cache warm/)
    assert.equal(readFileSync(requestsFile, 'utf8').trim().split('\n').length, 1)
    assert.equal(existsSync(eventFile), false)
  } finally {
    child.stdin.end()
    child.kill('SIGTERM')
  }
})
