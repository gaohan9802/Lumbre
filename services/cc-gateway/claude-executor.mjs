import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  buildClaudeArgs,
  buildProbeEnvironment,
  collectUsage,
  findResultText,
  findSessionId,
} from '../cc-probe/contract.mjs'

export class ClaudeExecutionError extends Error {
  constructor(code, safeMessage) {
    super(safeMessage)
    this.code = code
    this.safeMessage = safeMessage
  }
}

const TRANSCRIPT_SCAN_LIMIT_BYTES = 16 * 1024 * 1024
const ATTEMPT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONVERSATION_ID = /^[A-Za-z0-9._:-]{1,160}$/
const LUMBRE_MCP_CONFIG = JSON.stringify({ mcpServers: {
  lumbre: {
    type: 'stdio',
    command: 'node',
    args: ['/opt/lumbre/services/cc-gateway/lumbre-mcp-server.mjs'],
  },
} })

function findTranscript(home, sessionId) {
  if (!home || !sessionId) return null
  const root = path.join(home, '.claude', 'projects')
  const wanted = `${sessionId}.jsonl`
  const pending = [root]
  let visited = 0
  while (pending.length && visited < 4_000) {
    const directory = pending.pop()
    let entries
    try { entries = fs.readdirSync(directory, { withFileTypes: true }) }
    catch { continue }
    for (const entry of entries) {
      visited++
      const candidate = path.join(directory, entry.name)
      if (entry.isFile() && entry.name === wanted) return candidate
      if (entry.isDirectory()) pending.push(candidate)
      if (visited >= 4_000) break
    }
  }
  return null
}

function transcriptSnapshot(home, sessionId) {
  const transcriptPath = findTranscript(home, sessionId)
  if (!transcriptPath) return null
  try { return { path: transcriptPath, size: fs.statSync(transcriptPath).size } }
  catch { return null }
}

function isCompactBoundary(value) {
  return value?.type === 'system' && (
    value?.subtype === 'compact_boundary'
    || value?.source === 'compact'
    || value?.compactMetadata != null
    || value?.compact_metadata != null
  )
}

function streamDetectedCompaction(events) {
  return events.some(value => isCompactBoundary(value) || isCompactBoundary(value?.event))
}

function transcriptDetectedCompaction(home, sessionId, before) {
  const after = transcriptSnapshot(home, sessionId)
  if (!after) return false
  const sameFile = before?.path === after.path && after.size >= before.size
  const start = sameFile ? before.size : 0
  const available = Math.max(0, after.size - start)
  if (!available) return false
  const length = Math.min(available, TRANSCRIPT_SCAN_LIMIT_BYTES)
  const offset = available > length ? after.size - length : start
  let text
  try {
    const handle = fs.openSync(after.path, 'r')
    try {
      const buffer = Buffer.alloc(length)
      const bytesRead = fs.readSync(handle, buffer, 0, length, offset)
      text = buffer.subarray(0, bytesRead).toString('utf8')
    } finally { fs.closeSync(handle) }
  } catch { return false }

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const value = JSON.parse(line)
      if (isCompactBoundary(value) || isCompactBoundary(value?.event)) return true
    } catch {
      // A bounded tail can begin mid-line. Ignore only that incomplete record.
    }
  }
  return false
}

function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null
  const value = {
    inputTokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0,
    cacheCreationTokens: Number.isFinite(usage.cache_creation_input_tokens) ? usage.cache_creation_input_tokens : 0,
    cacheReadTokens: Number.isFinite(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : 0,
  }
  return Object.values(value).some(tokens => tokens > 0) ? value : null
}

function contextWindowSize(model, requestedModel) {
  const id = String(model || requestedModel || '').toLowerCase()
  if (!id) return null
  if (id.includes('[1m]') || /(?:sonnet|opus)-5\b/.test(id)) return 1_000_000
  if (/sonnet-4-6|sonnet-4-5|opus-4-[6-9]|haiku-4-5/.test(id)) return 200_000
  return null
}

export function collectContextSnapshot(events, requestedModel, clock = Date.now) {
  let usage = null
  let model = null
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (!usage) usage = normalizeUsage(event?.message?.usage)
    const candidate = event?.message?.model || (event?.type === 'system' && event?.subtype === 'init' ? event?.model : null)
    if (!model && typeof candidate === 'string' && candidate.trim()) model = candidate.trim()
    if (usage && model) break
  }
  if (!usage) return null
  const maxTokens = contextWindowSize(model, requestedModel)
  const usedTokens = usage.inputTokens + usage.cacheCreationTokens + usage.cacheReadTokens
  return {
    usedTokens,
    maxTokens,
    usedPercentage: maxTokens ? Math.min(100, Number(((usedTokens / maxTokens) * 100).toFixed(1))) : null,
    model: model || requestedModel || null,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    collectedAt: new Date(clock()).toISOString(),
    source: 'last_assistant_usage',
  }
}

export class ClaudeExecutor {
  constructor(options = {}) {
    this.binary = options.binary || 'claude'
    this.workspace = options.workspace || process.cwd()
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
    this.maxOutputBytes = options.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES
    this.env = buildProbeEnvironment(options.env || process.env)
    this.toolBridge = options.toolBridge || null
    this.toolEventsDir = options.toolEventsDir || path.join(this.env.HOME || this.workspace, 'tool-events')
    this.toolBridgeEnabled = !!this.toolBridge
    if (this.toolBridgeEnabled) fs.mkdirSync(this.toolEventsDir, { recursive: true, mode: 0o700 })
  }

  /**
   * @param {{
   *   prompt: string,
   *   model?: string,
   *   resumeSessionId?: string,
   *   forkSession?: boolean,
   *   toolsEnabled?: boolean,
   *   cacheWarm?: boolean,
   *   unattended?: boolean,
   *   signal?: AbortSignal,
   *   onText?: (text: string) => void,
   *   onThinking?: (text: string) => void,
   *   onToolCall?: (event: Record<string, any>) => void,
   *   attemptId?: string,
   *   conversationId?: string,
   * }} options
   */
  run({
    prompt,
    model,
    resumeSessionId,
    forkSession = false,
    toolsEnabled = true,
    cacheWarm = false,
    unattended = false,
    signal,
    onText,
    onThinking,
    onToolCall,
    attemptId,
    conversationId,
  }) {
    const useToolBridge = this.toolBridgeEnabled && (toolsEnabled || cacheWarm)
    const toolRunId = attemptId || (cacheWarm ? randomUUID() : '')
    if (useToolBridge && (!ATTEMPT_ID.test(toolRunId) || !CONVERSATION_ID.test(conversationId || ''))) {
      return Promise.reject(new ClaudeExecutionError('invalid_tool_context', 'Claude Code tool context is invalid'))
    }
    return new Promise((resolve, reject) => {
      const transcriptBefore = transcriptSnapshot(this.env.HOME, resumeSessionId)
      const toolEventFile = useToolBridge
        ? path.join(this.toolEventsDir, `${toolRunId}.jsonl`)
        : null
      if (toolEventFile) fs.writeFileSync(toolEventFile, '', { encoding: 'utf8', mode: 0o600 })
      const args = buildClaudeArgs({
        outputFormat: 'stream-json', model, resumeSessionId,
        forkSession,
        mcpConfig: useToolBridge ? LUMBRE_MCP_CONFIG : undefined,
        allowedTools: useToolBridge ? ['mcp__lumbre__*'] : undefined,
        maxTurns: useToolBridge ? 24 : undefined,
      })
      const childEnv = toolEventFile ? {
        ...this.env,
        LUMBRE_CC_TOOL_BRIDGE_URL: this.toolBridge.url,
        LUMBRE_CC_TOOL_BRIDGE_SECRET: this.toolBridge.secret,
        LUMBRE_CC_CONVERSATION_ID: conversationId,
        LUMBRE_CC_TOOL_EVENT_FILE: toolEventFile,
        LUMBRE_CC_MAX_TOOL_CALLS: String(this.toolBridge.maxCalls || 20),
        LUMBRE_CC_TOOL_SOURCE: unattended ? 'unattended-wake' : 'chat',
        LUMBRE_CC_CACHE_WARM: cacheWarm ? '1' : '0',
      } : this.env
      const child = spawn(this.binary, args, {
        cwd: this.workspace,
        env: childEnv,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdoutBuffer = ''
      let stderrBytes = 0
      let totalBytes = 0
      let settled = false
      let stoppedFor = null
      let forceKillTimer
      let timeout
      let toolEventTimer
      let toolEventOffset = 0
      let toolEventBuffer = ''
      const events = []

      const drainToolEvents = () => {
        if (!toolEventFile) return
        let bytes
        try { bytes = fs.readFileSync(toolEventFile) } catch { return }
        if (bytes.length <= toolEventOffset) return
        toolEventBuffer += bytes.subarray(toolEventOffset).toString('utf8')
        toolEventOffset = bytes.length
        for (;;) {
          const newline = toolEventBuffer.indexOf('\n')
          if (newline < 0) break
          const line = toolEventBuffer.slice(0, newline)
          toolEventBuffer = toolEventBuffer.slice(newline + 1)
          if (!line.trim()) continue
          let event
          try { event = JSON.parse(line) } catch { return stop('invalid_tool_event') }
          try { onToolCall?.(event) } catch { return stop('event_persist_failed') }
        }
      }

      const finish = (error, result) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (forceKillTimer) clearTimeout(forceKillTimer)
        if (toolEventTimer) clearInterval(toolEventTimer)
        signal?.removeEventListener('abort', abort)
        drainToolEvents()
        if (toolEventFile) try { fs.unlinkSync(toolEventFile) } catch {}
        if (error) reject(error)
        else resolve(result)
      }

      const stop = reason => {
        if (!stoppedFor) stoppedFor = reason
        child.kill('SIGTERM')
        if (!forceKillTimer) {
          forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 1_000)
          forceKillTimer.unref()
        }
      }

      const parseLine = line => {
        if (!line.trim()) return
        let event
        try { event = JSON.parse(line) }
        catch {
          stop('invalid_stream')
          return
        }
        events.push(event)
        const delta = event?.type === 'stream_event' ? event?.event?.delta : null
        const content = delta?.type === 'text_delta' ? delta.text
          : delta?.type === 'thinking_delta' ? delta.thinking : ''
        if (content) {
          try { delta.type === 'thinking_delta' ? onThinking?.(content) : onText?.(content) }
          catch { stop('event_persist_failed') }
        }
      }

      const abort = () => stop('cancelled')
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })

      timeout = setTimeout(() => stop('timeout'), this.timeoutMs)
      timeout.unref()
      if (toolEventFile) {
        toolEventTimer = setInterval(drainToolEvents, 100)
        toolEventTimer.unref()
      }

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => {
        totalBytes += Buffer.byteLength(chunk)
        if (totalBytes > this.maxOutputBytes) return stop('output_limit')
        stdoutBuffer += chunk
        for (;;) {
          const newline = stdoutBuffer.indexOf('\n')
          if (newline < 0) break
          const line = stdoutBuffer.slice(0, newline)
          stdoutBuffer = stdoutBuffer.slice(newline + 1)
          parseLine(line)
        }
      })
      child.stderr.on('data', chunk => {
        const bytes = Buffer.byteLength(chunk)
        stderrBytes += bytes
        totalBytes += bytes
        if (totalBytes > this.maxOutputBytes) stop('output_limit')
      })
      child.on('error', () => finish(new ClaudeExecutionError('spawn_failed', 'Claude Code could not start')))
      child.on('close', code => {
        drainToolEvents()
        if (stdoutBuffer.trim()) parseLine(stdoutBuffer)
        if (stoppedFor) return finish(new ClaudeExecutionError(stoppedFor, `Claude Code stopped: ${stoppedFor}`))
        if (code !== 0) return finish(new ClaudeExecutionError(`exit_${code ?? 'signal'}`, 'Claude Code request failed'))
        try {
          const sessionId = findSessionId(events)
          if (resumeSessionId && !forkSession && sessionId !== resumeSessionId) {
            throw new Error('Claude Code changed the resumed session id')
          }
          if (forkSession && sessionId === resumeSessionId) throw new Error('Claude Code did not fork the resumed session')
          let transcriptRemoved = false
          if (forkSession) {
            const forkTranscript = findTranscript(this.env.HOME, sessionId)
            if (forkTranscript) {
              try { fs.unlinkSync(forkTranscript); transcriptRemoved = true } catch {}
            }
          }
          finish(null, {
            text: findResultText(events),
            sessionId,
            usage: collectUsage(events),
            context: collectContextSnapshot(events, model),
            transcriptRemoved,
            compacted: streamDetectedCompaction(events)
              || transcriptDetectedCompaction(this.env.HOME, sessionId, transcriptBefore),
          })
        } catch {
          finish(new ClaudeExecutionError('invalid_result', 'Claude Code returned an invalid result'))
        }
      })

      child.stdin.on('error', () => {})
      child.stdin.end(prompt)
    })
  }
}
