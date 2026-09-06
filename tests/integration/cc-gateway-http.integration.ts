import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AttemptLedger } from '../../services/cc-gateway/attempt-ledger.mjs'
import { createGatewayServer } from '../../services/cc-gateway/http-server.mjs'
import { GatewayRuntime } from '../../services/cc-gateway/runtime.mjs'

const SECRET = 'stage-three-gateway-secret-with-32-characters'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

async function listen(server: ReturnType<typeof createGatewayServer>, root: string) {
  const socketPath = path.join(root, 'gateway.sock')
  await new Promise<void>(resolve => server.listen(socketPath, resolve))
  return socketPath
}

async function close(server: ReturnType<typeof createGatewayServer>) {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

function authHeaders(extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${SECRET}`, ...extra }
}

function request(socketPath: string, requestPath: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ socketPath, path: requestPath, method: options.method || 'GET', headers: options.headers }, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { body += chunk })
      response.on('end', () => resolve({ status: response.statusCode || 0, body }))
    })
    req.on('error', reject)
    req.end(options.body)
  })
}

function connectThenDisconnect(socketPath: string, requestPath: string, headers: Record<string, string>) {
  return new Promise<void>((resolve, reject) => {
    const req = http.request({ socketPath, path: requestPath, headers }, response => {
      response.once('data', () => {
        response.destroy()
        resolve()
      })
    })
    req.on('error', reject)
    req.end()
  })
}

test('HTTP auth, disconnect, polling and event replay preserve one attempt', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-http-'))
  const gate = deferred<void>()
  let calls = 0
  const ledger = new AttemptLedger(root)
  const runtime = new GatewayRuntime({
    ledger,
    executor: { run: async ({ onText }: any) => {
      calls++
      onText('回来')
      await gate.promise
      return { text: '回来还能找到。', sessionId: '550e8400-e29b-41d4-a716-446655440000', usage: { input_tokens: 8, output_tokens: 4 } }
    } },
  })
  const server = createGatewayServer({ runtime, secret: SECRET, heartbeatMs: 50 })
  const socketPath = await listen(server, root)

  try {
    const unauthorized = await request(socketPath, '/v1/attempts', { method: 'POST' })
    assert.equal(unauthorized.status, 401)

    const body = JSON.stringify({
      idempotency_key: 'turn:conversation-1:http-1',
      conversation_id: 'conversation-1',
      prompt: 'disconnect fixture',
      model: 'sonnet',
    })
    const createdResponse = await request(socketPath, '/v1/attempts', {
      method: 'POST', headers: authHeaders({ 'content-type': 'application/json' }), body,
    })
    assert.equal(createdResponse.status, 202)
    const created: any = JSON.parse(createdResponse.body)

    const duplicateResponse = await request(socketPath, '/v1/attempts', {
      method: 'POST', headers: authHeaders({ 'content-type': 'application/json' }), body,
    })
    assert.equal(duplicateResponse.status, 200)
    const duplicate: any = JSON.parse(duplicateResponse.body)
    assert.equal(duplicate.attempt.id, created.attempt.id)

    await connectThenDisconnect(socketPath, `/v1/attempts/${created.attempt.id}/events`, authHeaders())
    gate.resolve()
    await runtime.waitForIdle()
    assert.equal(calls, 1)

    const polled = await request(socketPath, `/v1/attempts/${created.attempt.id}`, { headers: authHeaders() })
    const final: any = JSON.parse(polled.body)
    assert.equal(final.attempt.status, 'completed')
    assert.equal(final.attempt.result.text, '回来还能找到。')

    const replay = await request(socketPath, `/v1/attempts/${created.attempt.id}/events?after=1`, { headers: authHeaders() })
    assert.match(replay.body, /event: running/)
    assert.match(replay.body, /event: completed/)
    assert.doesNotMatch(replay.body, new RegExp(SECRET))
  } finally {
    gate.resolve()
    await runtime.waitForIdle()
    await close(server)
    rmSync(root, { recursive: true, force: true })
  }
})
