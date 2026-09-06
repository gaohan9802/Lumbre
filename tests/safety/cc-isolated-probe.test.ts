import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  PINNED_CLAUDE_CODE_VERSION,
  buildClaudeArgs,
  buildProbeEnvironment,
  collectUsage,
  findResultText,
  findSessionId,
  parseJsonResult,
  parseStreamJson,
  sessionFingerprint,
} from '../../services/cc-probe/contract.mjs'
import { runProcess } from '../../services/cc-probe/process.mjs'

test('probe pins the reviewed stable CLI and disables every built-in tool', () => {
  assert.equal(PINNED_CLAUDE_CODE_VERSION, '2.1.236')
  const args = buildClaudeArgs({ outputFormat: 'stream-json' })
  assert.deepEqual(args.slice(0, 3), ['-p', '--tools', ''])
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk')
  assert.equal(args.includes('--strict-mcp-config'), true)
  assert.equal(args[args.indexOf('--mcp-config') + 1], '{"mcpServers":{}}')
  assert.equal(args.includes('--verbose'), true)
  assert.equal(args.includes('--include-partial-messages'), true)
  assert.equal(args.some(arg => arg.includes('dangerously-skip-permissions')), false)
})

test('resume keeps an explicit session target and fork cannot run without one', () => {
  const sessionId = '550e8400-e29b-41d4-a716-446655440000'
  const args = buildClaudeArgs({ resumeSessionId: sessionId, forkSession: true })
  assert.equal(args[args.indexOf('--resume') + 1], sessionId)
  assert.equal(args.includes('--fork-session'), true)
  assert.throws(() => buildClaudeArgs({ forkSession: true }), /must resume/)
  assert.throws(() => buildClaudeArgs({ resumeSessionId: 'not-a-session' }), /invalid/)
})

test('child environment permits subscription OAuth but strips API and Lumbre secrets', () => {
  const env = buildProbeEnvironment({
    PATH: '/bin',
    HOME: '/probe/home',
    CLAUDE_CODE_OAUTH_TOKEN: 'oauth-secret',
    ANTHROPIC_API_KEY: 'api-secret',
    ANTHROPIC_AUTH_TOKEN: 'api-auth-secret',
    DATA_DIR: '/persistent',
    LUMBRE_AUTH_SECRET: 'lumbre-secret',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
  })
  assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, 'oauth-secret')
  assert.equal(env.ANTHROPIC_API_KEY, undefined)
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined)
  assert.equal(env.DATA_DIR, undefined)
  assert.equal(env.LUMBRE_AUTH_SECRET, undefined)
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined)
  assert.equal(env.DISABLE_UPDATES, '1')
})

test('structured output parsing records usage without exposing full session ids', () => {
  const sessionId = '550e8400-e29b-41d4-a716-446655440000'
  const envelope = parseJsonResult(JSON.stringify({
    type: 'result', result: 'OK', session_id: sessionId,
    usage: { input_tokens: 9, output_tokens: 1, cache_read_input_tokens: 4 },
  }))
  const stream = parseStreamJson([
    JSON.stringify({ type: 'assistant', session_id: sessionId, message: { usage: { output_tokens: 99 } } }),
    JSON.stringify({ type: 'result', result: 'DONE', session_id: sessionId, usage: { output_tokens: 2 } }),
  ].join('\n'))
  assert.equal(findSessionId([envelope]), sessionId)
  assert.equal(findResultText(stream), 'DONE')
  assert.equal(collectUsage(stream)?.output_tokens, 2)
  assert.deepEqual(collectUsage([envelope]), {
    input_tokens: 9,
    output_tokens: 1,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 4,
  })
  assert.equal(sessionFingerprint(sessionId).length, 12)
  assert.doesNotMatch(sessionFingerprint(sessionId), new RegExp(sessionId))
})

test('process runner does not use a shell and terminates a timed-out child', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-probe-test-'))
  try {
    const quick = await runProcess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.argv[1])', 'literal;$(unsafe)'],
      cwd: workspace,
      env: { PATH: process.env.PATH || '' },
      timeoutMs: 5_000,
      maxOutputBytes: 1_024,
    })
    assert.equal(quick.stdout, 'literal;$(unsafe)')
    assert.equal(quick.code, 0)

    const slow = await runProcess({
      command: process.execPath,
      args: ['-e', 'setTimeout(() => {}, 10000)'],
      cwd: workspace,
      env: { PATH: process.env.PATH || '' },
      timeoutMs: 2_000,
      maxOutputBytes: 1_024,
    })
    assert.equal(slow.timedOut, true)
    assert.notEqual(slow.signal, null)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('process runner stops output floods at the configured byte ceiling', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-probe-output-'))
  try {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(4096))'],
      cwd: workspace,
      env: { PATH: process.env.PATH || '' },
      timeoutMs: 5_000,
      maxOutputBytes: 128,
    })
    assert.equal(result.outputLimited, true)
    assert.equal(result.stdout.length <= 128, true)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})

test('process runner escalates to SIGKILL when a timed-out child ignores SIGTERM', async () => {
  const workspace = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-probe-stubborn-'))
  try {
    const result = await runProcess({
      command: process.execPath,
      args: ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'],
      cwd: workspace,
      env: { PATH: process.env.PATH || '' },
      timeoutMs: 2_000,
      maxOutputBytes: 1_024,
    })
    assert.equal(result.timedOut, true)
    assert.equal(result.signal, 'SIGKILL')
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
