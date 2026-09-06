import { createHash } from 'node:crypto'

export const PINNED_CLAUDE_CODE_VERSION = '2.1.236'
export const DEFAULT_TIMEOUT_MS = 180_000
export const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SAFE_ENV_NAMES = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'TZ',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'NO_PROXY',
  'CLAUDE_CODE_OAUTH_TOKEN',
]

/**
 * @param {Record<string, string | undefined>} source
 * @returns {Record<string, string>}
 */
export function buildProbeEnvironment(source = process.env) {
  const safe = {}
  for (const name of SAFE_ENV_NAMES) {
    if (typeof source[name] === 'string' && source[name]) safe[name] = source[name]
  }

  return {
    ...safe,
    CI: '1',
    NO_COLOR: '1',
    TERM: 'dumb',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_UPDATES: '1',
  }
}

/**
 * @typedef {object} ClaudeArgsOptions
 * @property {'json' | 'stream-json'} [outputFormat]
 * @property {string} [model]
 * @property {string} [resumeSessionId]
 * @property {boolean} [forkSession]
 */

/** @param {ClaudeArgsOptions} [options] */
export function buildClaudeArgs({
  outputFormat = 'json',
  model,
  resumeSessionId,
  forkSession = false,
} = {}) {
  if (!['json', 'stream-json'].includes(outputFormat)) {
    throw new Error(`Unsupported probe output format: ${outputFormat}`)
  }
  if (resumeSessionId && !UUID_PATTERN.test(resumeSessionId)) {
    throw new Error('Refusing to resume an invalid Claude Code session id')
  }
  if (forkSession && !resumeSessionId) {
    throw new Error('A fork probe must resume an existing session')
  }

  const args = [
    '-p',
    '--tools', '',
    '--permission-mode', 'dontAsk',
    '--no-chrome',
    '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}',
    '--max-turns', '1',
    '--output-format', outputFormat,
  ]

  if (outputFormat === 'stream-json') {
    args.push('--verbose', '--include-partial-messages')
  }
  if (model) args.push('--model', model)
  if (resumeSessionId) args.push('--resume', resumeSessionId)
  if (forkSession) args.push('--fork-session')

  return args
}

/** @param {string} stdout */
export function parseJsonResult(stdout) {
  let value
  try {
    value = JSON.parse(stdout)
  } catch {
    throw new Error('Claude Code did not return valid JSON')
  }
  if (!value || typeof value !== 'object') throw new Error('Claude Code returned an invalid JSON envelope')
  return value
}

/** @param {string} stdout */
export function parseStreamJson(stdout) {
  const events = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      throw new Error('Claude Code stream contained a non-JSON line')
    }
  }
  if (!events.length) throw new Error('Claude Code returned an empty event stream')
  return events
}

/** @param {Array<Record<string, any>>} values */
export function findSessionId(values) {
  for (const value of values) {
    const candidate = value?.session_id
    if (typeof candidate === 'string' && UUID_PATTERN.test(candidate)) return candidate
  }
  throw new Error('Claude Code output did not contain a valid session id')
}

/** @param {Array<Record<string, any>>} values */
export function findResultText(values) {
  for (let index = values.length - 1; index >= 0; index--) {
    const value = values[index]
    if (typeof value?.result === 'string') return value.result
  }
  return ''
}

/** @param {string} sessionId */
export function sessionFingerprint(sessionId) {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 12)
}

/** @param {Array<Record<string, any>>} values */
export function collectUsage(values) {
  for (let index = values.length - 1; index >= 0; index--) {
    const candidates = [values[index]?.usage, values[index]?.message?.usage]
    for (const usage of candidates) {
      if (!usage || typeof usage !== 'object') continue
      const normalized = {
        input_tokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0,
        output_tokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0,
        cache_creation_input_tokens: Number.isFinite(usage.cache_creation_input_tokens) ? usage.cache_creation_input_tokens : 0,
        cache_read_input_tokens: Number.isFinite(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : 0,
      }
      if (Object.values(normalized).some(value => value > 0)) return normalized
    }
  }
  return null
}

/** @param {string} stdout */
export function extractVersion(stdout) {
  return stdout.match(/\b(\d+\.\d+\.\d+)\b/)?.[1] || null
}
