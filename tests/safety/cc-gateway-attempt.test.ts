import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AttemptLedger } from '../../services/cc-gateway/attempt-ledger.mjs'
import { ClaudeExecutor } from '../../services/cc-gateway/claude-executor.mjs'
import { GatewayRuntime } from '../../services/cc-gateway/runtime.mjs'
import { assertGatewayDataDir } from '../../services/cc-gateway/storage.mjs'

function fixtureInput(overrides: Record<string, string> = {}) {
  return {
    idempotencyKey: 'turn:conversation-1:message-1',
    conversationId: 'conversation-1',
    prompt: 'sanitized test prompt',
    model: 'sonnet',
    ...overrides,
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('attempt ledger stores one durable task for repeated idempotency keys', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-ledger-'))
  try {
    const ledger = new AttemptLedger(root)
    const first = ledger.createOrGet(fixtureInput())
    const second = ledger.createOrGet(fixtureInput({ prompt: 'must not replace the first prompt' }))
    assert.equal(first.created, true)
    assert.equal(second.created, false)
    assert.equal(second.attempt.id, first.attempt.id)
    assert.equal(second.attempt.prompt, 'sanitized test prompt')

    const stored = readFileSync(path.join(root, 'attempts', `${first.attempt.id}.json`), 'utf8')
    const index = readFileSync(path.join(root, 'idempotency-index.json'), 'utf8')
    assert.doesNotMatch(stored + index, /turn:conversation-1:message-1/)
    assert.equal((Number.parseInt((readFileSync(path.join(root, 'attempts', `${first.attempt.id}.json`), 'utf8').length.toString())) > 0), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('result is durable before the completed event is published', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-runtime-'))
  try {
    const gate = deferred<void>()
    let calls = 0
    const ledger = new AttemptLedger(root)
    const runtime = new GatewayRuntime({
      ledger,
      executor: { run: async ({ onText }: any) => {
        calls++
        onText('星')
        await gate.promise
        return { text: '星星在这里。', sessionId: '550e8400-e29b-41d4-a716-446655440000', usage: { output_tokens: 5 } }
      } },
    })
    const first = runtime.submit(fixtureInput())
    const repeated = runtime.submit(fixtureInput())
    assert.equal(first.attempt!.id, repeated.attempt!.id)
    assert.equal(repeated.reused, true)

    const completionSeen = deferred<void>()
    runtime.subscribe(first.attempt!.id, (event: any) => {
      if (event.type !== 'completed') return
      assert.equal(ledger.get(first.attempt!.id)?.result?.text, '星星在这里。')
      completionSeen.resolve()
    })
    gate.resolve()
    await runtime.waitForIdle()
    await completionSeen.promise
    assert.equal(calls, 1)
    assert.equal(runtime.get(first.attempt!.id)?.status, 'completed')
    assert.equal(runtime.get(first.attempt!.id)?.result?.text, '星星在这里。')
    const stored = readFileSync(path.join(root, 'attempts', `${first.attempt!.id}.json`), 'utf8')
    const backup = readFileSync(path.join(root, 'attempts', `${first.attempt!.id}.json.bak`), 'utf8')
    assert.doesNotMatch(stored, /sanitized test prompt/)
    assert.doesNotMatch(backup, /sanitized test prompt/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('explicit cancellation aborts the running child and records cancelled', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-cancel-'))
  try {
    const started = deferred<void>()
    const ledger = new AttemptLedger(root)
    const runtime = new GatewayRuntime({
      ledger,
      executor: { run: ({ signal }: any) => new Promise((_resolve, reject) => {
        started.resolve()
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'cancelled' })), { once: true })
      }) },
    })
    const submitted = runtime.submit(fixtureInput())
    await started.promise
    const requested = runtime.cancel(submitted.attempt!.id)
    assert.equal(requested?.cancelRequested, true)
    await runtime.waitForIdle()
    assert.equal(runtime.get(submitted.attempt!.id)?.status, 'cancelled')
    assert.equal(runtime.getEvents(submitted.attempt!.id)?.at(-1)?.type, 'cancelled')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('restart fails an orphaned running task and keeps queued work recoverable', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-restart-'))
  try {
    const first = new AttemptLedger(root)
    const running = first.createOrGet(fixtureInput()).attempt
    first.markRunning(running.id)
    const queued = first.createOrGet(fixtureInput({ idempotencyKey: 'turn:conversation-1:message-2' })).attempt

    const afterRestart = new AttemptLedger(root)
    assert.deepEqual(afterRestart.recoverInterrupted(), [queued.id])
    assert.equal(afterRestart.get(running.id)?.status, 'failed')
    assert.equal(afterRestart.get(running.id)?.error?.code, 'gateway_restarted')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Claude executor keeps shell disabled and parses stream-json from a fixed binary', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-executor-'))
  try {
    const binary = path.join(root, 'fake-claude')
    writeFileSync(binary, `#!/usr/bin/env node
const fs = require('node:fs')
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => { input += chunk })
process.stdin.on('end', () => {
  fs.writeFileSync('observed.json', JSON.stringify({ args: process.argv.slice(2), input, env: Object.keys(process.env).sort() }))
  const id = '550e8400-e29b-41d4-a716-446655440000'
  console.log(JSON.stringify({ type: 'stream_event', session_id: id, event: { delta: { type: 'text_delta', text: '好' } } }))
  console.log(JSON.stringify({ type: 'result', result: '好', session_id: id, usage: { input_tokens: 2, output_tokens: 1 } }))
})
`, { mode: 0o700 })
    chmodSync(binary, 0o700)
    const deltas: string[] = []
    const executor = new ClaudeExecutor({ binary, workspace: root, env: {
      PATH: process.env.PATH || '', HOME: root, CLAUDE_CODE_OAUTH_TOKEN: 'fixture-oauth',
      ANTHROPIC_API_KEY: 'must-not-pass', DATA_DIR: '/persistent',
    } })
    const result: any = await executor.run({ prompt: 'hello', model: 'sonnet', signal: undefined, onText: (text: string) => deltas.push(text) })
    const observed = JSON.parse(readFileSync(path.join(root, 'observed.json'), 'utf8'))
    assert.equal(result.text, '好')
    assert.deepEqual(deltas, ['好'])
    assert.equal(observed.args[observed.args.indexOf('--tools') + 1], '')
    assert.equal(observed.args.some((arg: string) => /dangerously|Bash|Shell/.test(arg)), false)
    assert.equal(observed.env.includes('CLAUDE_CODE_OAUTH_TOKEN'), true)
    assert.equal(observed.env.includes('ANTHROPIC_API_KEY'), false)
    assert.equal(observed.env.includes('DATA_DIR'), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Claude executor stops safely when a streamed event cannot be persisted', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-persist-failure-'))
  try {
    const binary = path.join(root, 'fake-claude')
    writeFileSync(binary, `#!/usr/bin/env node
console.log(JSON.stringify({ type: 'stream_event', event: { delta: { type: 'text_delta', text: 'not durable' } } }))
setInterval(() => {}, 1000)
process.on('SIGTERM', () => process.exit(0))
`, { mode: 0o700 })
    chmodSync(binary, 0o700)
    const executor = new ClaudeExecutor({ binary, workspace: root, env: { PATH: process.env.PATH || '', HOME: root } })
    await assert.rejects(
      executor.run({ prompt: 'hello', model: 'sonnet', signal: undefined, onText: () => { throw new Error('disk unavailable') } }),
      (error: any) => error?.code === 'event_persist_failed',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('gateway refuses the Lumbre production volume', () => {
  assert.throws(() => assertGatewayDataDir('relative/data'), /absolute/)
  assert.throws(() => assertGatewayDataDir('/persistent'), /must not use/)
  assert.throws(() => assertGatewayDataDir('/persistent/cc'), /must not use/)
  assert.equal(assertGatewayDataDir('/gateway-data'), '/gateway-data')
})

test('corrupt attempt data fails closed instead of creating a duplicate task', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-corrupt-'))
  try {
    const ledger = new AttemptLedger(root)
    const created = ledger.createOrGet(fixtureInput()).attempt
    writeFileSync(path.join(root, 'attempts', `${created.id}.json`), '{broken', 'utf8')
    assert.throws(() => new AttemptLedger(root), /JSON/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
