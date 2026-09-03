import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-tool-permissions-'))
process.env.DATA_DIR = root
process.env.LUMBRE_AUTH_SECRET = 'stage-two-confirmation-secret-for-tests'

let executor: typeof import('../../src/server/agent/executor')
let confirmations: typeof import('../../src/server/data/repositories/tool-security')
let contextModule: typeof import('../../src/server/agent/context')
let policy: typeof import('../../src/server/agent/policy')
let registry: typeof import('../../src/server/agent/registry')

before(async () => {
  contextModule = await import('../../src/server/agent/context')
  policy = await import('../../src/server/agent/policy')
  registry = await import('../../src/server/agent/registry')
  executor = await import('../../src/server/agent/executor')
  confirmations = await import('../../src/server/data/repositories/tool-security')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('all legacy tool contracts have exactly one policy registration', () => {
  assert.equal(registry.registeredToolCount(), 66)
  assert.equal(registry.ALL_TOOLS.length, 66)
  assert.equal(new Set(registry.ALL_TOOLS.map(tool => tool.name)).size, 66)
  assert.deepEqual(registry.ALL_TOOLS.slice(0, 6).map(tool => tool.name), ['breath', 'hold', 'grow', 'trace', 'pulse', 'dream'])
  assert.equal(registry.ALL_TOOLS.findIndex(tool => tool.name === 'fetch_json') < registry.ALL_TOOLS.findIndex(tool => tool.name === 'get_weather'), true)
  assert.equal(registry.ALL_TOOLS.findIndex(tool => tool.name === 'read_period') < registry.ALL_TOOLS.findIndex(tool => tool.name === 'gmail_status'), true)
})

test('green, yellow, red, and black policy decisions fail closed', () => {
  const chat = contextModule.createToolContext({ source: 'chat', actorId: 'fixture', sessionId: 'session-a' })
  const wake = contextModule.createToolContext({ source: 'unattended-wake', actorId: 'wake', sessionId: 'session-a' })
  const read = registry.getRegisteredTool('read_diary')!
  const write = registry.getRegisteredTool('write_diary')!
  const remove = registry.getRegisteredTool('delete_diary')!
  const trace = registry.getRegisteredTool('trace')!

  assert.deepEqual(policy.evaluateToolPolicy(read, {}, chat), { allowed: true, level: 'green' })
  assert.deepEqual(policy.evaluateToolPolicy(write, {}, chat), { allowed: true, level: 'yellow' })
  assert.equal(policy.evaluateToolPolicy(remove, {}, chat).requiresConfirmation, true)
  assert.deepEqual(policy.evaluateToolPolicy(remove, {}, wake), {
    allowed: false,
    level: 'black',
    reason: 'delete_diary is not allowed from unattended-wake',
  })
  assert.equal(policy.resolveToolRisk(trace, { resolved: 1 }), 'yellow')
  assert.equal(policy.resolveToolRisk(trace, { delete: true }), 'red')
})

test('unattended wake receives only its explicit whitelist and cannot see trace deletion', () => {
  const wake = contextModule.createToolContext({ source: 'unattended-wake', actorId: 'wake' })
  const names = registry.toolsForContext(wake).map(tool => tool.name)
  for (const blocked of ['delete_diary', 'remove_todo', 'send_email', 'reply_email', 'get_location', 'set_password']) {
    assert.equal(names.includes(blocked), false, blocked)
  }
  const trace = registry.toolsForContext(wake).find(tool => tool.name === 'trace')!
  assert.equal('delete' in trace.input_schema.properties, false)
})

test('red tools issue single-use, actor-and-session-bound confirmations', async () => {
  const context = contextModule.createToolContext({ source: 'chat', actorId: 'fixture-user', sessionId: 'session-a' })
  const pendingRaw = await executor.executeTool('delete_diary', { target_date: '2026-09-03', author: 'star' }, context)
  const pending = JSON.parse(pendingRaw)
  assert.equal(pending.code, 'CONFIRMATION_REQUIRED')

  const forged = await executor.resolveAndExecuteToolConfirmation({
    token: pending.confirmation.token,
    actorId: 'other-user',
    sessionId: 'session-a',
    approve: true,
  })
  assert.deepEqual(forged, { ok: false, code: 'forbidden' })

  const rejected = await executor.resolveAndExecuteToolConfirmation({
    token: pending.confirmation.token,
    actorId: 'fixture-user',
    sessionId: 'session-a',
    approve: false,
  })
  assert.equal(rejected.ok, true)
  assert.equal(rejected.code, 'rejected')

  const repeated = await executor.resolveAndExecuteToolConfirmation({
    token: pending.confirmation.token,
    actorId: 'fixture-user',
    sessionId: 'session-a',
    approve: true,
  })
  assert.deepEqual(repeated, { ok: false, code: 'already-used' })
})

test('expired confirmation tokens are rejected without executing', () => {
  const old = new Date('2026-09-03T10:00:00.000Z')
  const { token } = confirmations.createToolConfirmation({
    tool: 'delete_note', input: { note_id: 'fixture' }, actorId: 'fixture-user', sessionId: 'session-a', requestedSource: 'chat',
  }, { now: old, ttlMs: 1000 })
  const result = confirmations.resolveToolConfirmation(token, 'fixture-user', 'session-a', true, new Date(old.getTime() + 1001))
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, 'expired')
})

test('batch execution enforces one total limit and stops later writes after a failed write', async () => {
  const context = contextModule.createToolContext({ source: 'chat', actorId: 'fixture-user', sessionId: 'session-a' })
  const limited = await executor.executeToolBatch([
    { name: 'get_weather', input: {} },
    { name: 'read_period', input: {} },
  ], context, 1)
  assert.equal(limited.length, 2)
  assert.match(limited[1].result, /limit reached/)

  const stopped = await executor.executeToolBatch([
    { name: 'unknown_write', input: {} },
    { name: 'write_note', input: { author: 'star', content: 'must not run' } },
    { name: 'get_weather', input: {} },
  ], context, 3)
  assert.match(stopped[0].result, /Unknown tool/)
  assert.match(stopped[1].result, /previous write/)
  assert.doesNotMatch(stopped[2].result, /previous write/)
})

test('audit log records actor, source, tool and outcome without content values', async () => {
  const context = contextModule.createToolContext({ source: 'chat', actorId: 'audit-user', sessionId: 'audit-session' })
  await executor.executeTool('get_weather', {}, context)
  const raw = readFileSync(path.join(root, 'tool-audit.jsonl'), 'utf8')
  assert.match(raw, /"actorId":"audit-user"/)
  assert.match(raw, /"source":"chat"/)
  assert.match(raw, /"tool":"get_weather"/)
  assert.match(raw, /"outcome":"allowed"/)
})
