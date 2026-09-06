#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { AttemptLedger } from './attempt-ledger.mjs'
import { ClaudeExecutor } from './claude-executor.mjs'
import { createGatewayServer } from './http-server.mjs'
import { GatewayRuntime } from './runtime.mjs'
import { assertGatewayDataDir } from './storage.mjs'

function positiveInteger(name, fallback) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

try {
  if (process.env.CC_GATEWAY_ISOLATED !== '1') throw new Error('Refusing to run outside the isolated CC gateway container')
  const secret = process.env.LUMBRE_CC_GATEWAY_SECRET || ''
  const oauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN || ''
  if (secret.length < 32) throw new Error('LUMBRE_CC_GATEWAY_SECRET must be at least 32 characters')
  if (!oauthToken) throw new Error('CLAUDE_CODE_OAUTH_TOKEN is required')

  const dataDir = assertGatewayDataDir(process.env.CC_GATEWAY_DATA_DIR || '/gateway-data')
  const workspace = path.resolve(process.env.CC_GATEWAY_WORKSPACE || '/gateway-workspace')
  fs.mkdirSync(workspace, { recursive: true, mode: 0o700 })
  const ledger = new AttemptLedger(dataDir)
  const executor = new ClaudeExecutor({
    workspace,
    timeoutMs: positiveInteger('CC_GATEWAY_TIMEOUT_MS', 180_000),
    maxOutputBytes: positiveInteger('CC_GATEWAY_MAX_OUTPUT_BYTES', 4 * 1024 * 1024),
  })
  const runtime = new GatewayRuntime({ ledger, executor, concurrency: positiveInteger('CC_GATEWAY_CONCURRENCY', 1) })
  runtime.recover()
  const server = createGatewayServer({ runtime, secret })
  const port = positiveInteger('PORT', 8787)
  server.listen(port, '0.0.0.0', () => {
    process.stdout.write(`CC_GATEWAY_READY port=${port}\n`)
  })
} catch (error) {
  process.stderr.write(`CC_GATEWAY_START_FAILED ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
}
