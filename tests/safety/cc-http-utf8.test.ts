import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createGatewayServer } from '../../services/cc-gateway/http-server.mjs'
import { AttemptLedger } from '../../services/cc-gateway/attempt-ledger.mjs'
import { ContextBridge } from '../../services/cc-gateway/context-bridge.mjs'
import { GatewayRuntime } from '../../services/cc-gateway/runtime.mjs'

test('HTTP chunk boundaries cannot corrupt Unicode history or rebase a CC session', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-utf8-'))
  const secret = 'utf8-regression-secret-with-32-characters'
  const ledger = new AttemptLedger(root)
  const runs: any[] = []
  const runtime = new GatewayRuntime({
    ledger, contextBridge: new ContextBridge(ledger) as any,
    executor: { run: async (input: any) => {
      runs.push(input)
      return { text: '收到。', sessionId: input.resumeSessionId || `session-${runs.length}` }
    } },
  })
  const server = createGatewayServer({ runtime, secret })
  const handler = server.listeners('request')[0] as Function
  const history: any[] = [{ id: 'old-api', role: 'assistant', route: 'api', content: '屏幕亮着。小火🦦晚安。' }]

  try {
    for (let turn = 0; turn < 3; turn++) {
      history.push({ id: `u${turn}`, role: 'user', route: 'claude-code', content: `继续 ${turn}` })
      const bytes = Buffer.from(JSON.stringify({
        idempotency_key: `utf8-${turn}`, conversation_id: 'utf8-conversation', model: 'sonnet',
        context: { system: '保持自然。', messages: history },
      }))
      let status = 0
      let result: any
      // Drive the actual HTTP handler with deterministic network chunks; no
      // timing assumptions about how a local socket coalesces writes.
      await handler({
        method: 'POST', url: '/v1/attempts', headers: { authorization: `Bearer ${secret}` },
        async *[Symbol.asyncIterator]() {
          const size = turn === 0 ? bytes.length : turn
          for (let offset = 0; offset < bytes.length; offset += size) yield bytes.subarray(offset, offset + size)
        },
      }, {
        setHeader() {},
        writeHead(value: number) { status = value },
        end(body: string) { result = JSON.parse(body) },
      })
      assert.equal(status, 202)
      await runtime.waitForIdle()
      assert.equal(result.attempt.sessionMode, turn === 0 ? 'bootstrap' : 'resume')
      assert.equal(ledger.get(result.attempt.id).result.sessionId, 'session-1')
      assert.doesNotMatch(runs[turn].prompt, /\uFFFD/)
      if (turn === 0) assert.ok(runs[turn].prompt.includes(history[0].content))
      history.push({ id: `a${turn}`, role: 'assistant', route: 'claude-code', content: '收到。', ccAttemptId: result.attempt.id })
    }
    assert.deepEqual(runs.map(run => run.resumeSessionId), [undefined, 'session-1', 'session-1'])
  } finally {
    await runtime.waitForIdle()
    rmSync(root, { recursive: true, force: true })
  }
})
