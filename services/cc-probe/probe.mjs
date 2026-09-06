#!/usr/bin/env node

import path from 'node:path'
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  PINNED_CLAUDE_CODE_VERSION,
  buildClaudeArgs,
  buildProbeEnvironment,
  collectUsage,
  extractVersion,
  findResultText,
  findSessionId,
  parseJsonResult,
  parseStreamJson,
  sessionFingerprint,
} from './contract.mjs'
import { runProcess } from './process.mjs'

const command = process.argv[2] || 'inspect'
const claudeBinary = process.env.CC_PROBE_CLAUDE_BIN || 'claude'
const workspace = path.resolve(process.env.CC_PROBE_WORKSPACE || process.cwd())
const model = process.env.CC_PROBE_MODEL || undefined
const timeoutMs = readPositiveInteger('CC_PROBE_TIMEOUT_MS', DEFAULT_TIMEOUT_MS)
const maxOutputBytes = readPositiveInteger('CC_PROBE_MAX_OUTPUT_BYTES', DEFAULT_MAX_OUTPUT_BYTES)
const childEnv = buildProbeEnvironment()

function readPositiveInteger(name, fallback) {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`)
  return value
}

function safeFailure(result) {
  if (result.timedOut) return 'timeout'
  if (result.outputLimited) return 'output_limit'
  if (result.code !== 0) return `exit_${result.code ?? 'signal'}`
  return null
}

async function invoke(args, prompt = '') {
  return runProcess({
    command: claudeBinary,
    args,
    cwd: workspace,
    env: childEnv,
    stdin: prompt,
    timeoutMs,
    maxOutputBytes,
  })
}

async function inspect() {
  const versionResult = await invoke(['--version'])
  const version = extractVersion(versionResult.stdout)
  const authResult = await invoke(['auth', 'status'])
  let auth = null
  try { auth = JSON.parse(authResult.stdout) } catch {}

  const report = {
    probe: 'inspect',
    ok: versionResult.code === 0 && version === PINNED_CLAUDE_CODE_VERSION,
    expectedVersion: PINNED_CLAUDE_CODE_VERSION,
    actualVersion: version,
    versionFailure: safeFailure(versionResult),
    auth: {
      loggedIn: auth?.loggedIn === true,
      authMethod: typeof auth?.authMethod === 'string' ? auth.authMethod : null,
      apiProvider: typeof auth?.apiProvider === 'string' ? auth.apiProvider : null,
      failure: safeFailure(authResult),
    },
    isolation: {
      inheritedApiKey: false,
      inheritedApiAuthToken: false,
      inheritedProductionDataDir: false,
      builtinTools: [],
      mcpServers: [],
    },
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (!report.ok) process.exitCode = 1
}

function assertRun(result, label) {
  const failure = safeFailure(result)
  if (failure) throw new Error(`${label} failed: ${failure}`)
}

function assertMarker(text, marker, label) {
  if (text.trim() !== marker) throw new Error(`${label} returned an unexpected marker`)
}

async function smoke() {
  const freshMarker = 'LUMBRE_CC_PROBE_FRESH_OK'
  const resumeMarker = 'LUMBRE_CC_PROBE_RESUME_OK'
  const forkMarker = 'LUMBRE_CC_PROBE_FORK_OK'

  const freshResult = await invoke(
    buildClaudeArgs({ outputFormat: 'json', model }),
    `Reply with exactly ${freshMarker}. Do not use tools.`,
  )
  assertRun(freshResult, 'fresh JSON probe')
  const freshEnvelope = parseJsonResult(freshResult.stdout)
  const freshSessionId = findSessionId([freshEnvelope])
  assertMarker(findResultText([freshEnvelope]), freshMarker, 'fresh JSON probe')

  const resumeResult = await invoke(
    buildClaudeArgs({ outputFormat: 'stream-json', model, resumeSessionId: freshSessionId }),
    `Reply with exactly ${resumeMarker}. Do not use tools.`,
  )
  assertRun(resumeResult, 'resume stream probe')
  const resumeEvents = parseStreamJson(resumeResult.stdout)
  const resumedSessionId = findSessionId(resumeEvents)
  assertMarker(findResultText(resumeEvents), resumeMarker, 'resume stream probe')
  if (resumedSessionId !== freshSessionId) throw new Error('Resume changed the session id')

  const forkResult = await invoke(
    buildClaudeArgs({ outputFormat: 'json', model, resumeSessionId: freshSessionId, forkSession: true }),
    `Reply with exactly ${forkMarker}. Do not use tools.`,
  )
  assertRun(forkResult, 'fork JSON probe')
  const forkEnvelope = parseJsonResult(forkResult.stdout)
  const forkSessionId = findSessionId([forkEnvelope])
  assertMarker(findResultText([forkEnvelope]), forkMarker, 'fork JSON probe')
  if (forkSessionId === freshSessionId) throw new Error('Fork reused the original session id')

  process.stdout.write(`${JSON.stringify({
    probe: 'smoke',
    ok: true,
    model: model || null,
    freshSession: sessionFingerprint(freshSessionId),
    resumedSession: sessionFingerprint(resumedSessionId),
    forkedSession: sessionFingerprint(forkSessionId),
    resumeKeptSession: true,
    forkCreatedSession: true,
    usage: {
      fresh: collectUsage([freshEnvelope]),
      resume: collectUsage(resumeEvents),
      fork: collectUsage([forkEnvelope]),
    },
  }, null, 2)}\n`)
}

try {
  if (process.env.CC_PROBE_ISOLATED !== '1') {
    throw new Error('Refusing to run outside the explicitly isolated probe environment')
  }
  if (command === 'inspect') await inspect()
  else if (command === 'smoke') await smoke()
  else throw new Error(`Unknown command: ${command}. Use inspect or smoke.`)
} catch (error) {
  process.stderr.write(`CC_PROBE_FAILED ${error instanceof Error ? error.message : 'unknown error'}\n`)
  process.exitCode = 1
}
