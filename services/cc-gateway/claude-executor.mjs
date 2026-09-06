import { spawn } from 'node:child_process'
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

export class ClaudeExecutor {
  constructor(options = {}) {
    this.binary = options.binary || 'claude'
    this.workspace = options.workspace || process.cwd()
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
    this.maxOutputBytes = options.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES
    this.env = buildProbeEnvironment(options.env || process.env)
  }

  run({ prompt, model, resumeSessionId, signal, onText }) {
    return new Promise((resolve, reject) => {
      const transcriptBefore = transcriptSnapshot(this.env.HOME, resumeSessionId)
      const args = buildClaudeArgs({ outputFormat: 'stream-json', model, resumeSessionId })
      const child = spawn(this.binary, args, {
        cwd: this.workspace,
        env: this.env,
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
      const events = []

      const finish = (error, result) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        if (forceKillTimer) clearTimeout(forceKillTimer)
        signal?.removeEventListener('abort', abort)
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
        const delta = event?.type === 'stream_event' && event?.event?.delta?.type === 'text_delta'
          ? event.event.delta.text
          : ''
        if (delta) {
          try { onText?.(delta) }
          catch { stop('event_persist_failed') }
        }
      }

      const abort = () => stop('cancelled')
      if (signal?.aborted) abort()
      else signal?.addEventListener('abort', abort, { once: true })

      timeout = setTimeout(() => stop('timeout'), this.timeoutMs)
      timeout.unref()

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
        if (stdoutBuffer.trim()) parseLine(stdoutBuffer)
        if (stoppedFor) return finish(new ClaudeExecutionError(stoppedFor, `Claude Code stopped: ${stoppedFor}`))
        if (code !== 0) return finish(new ClaudeExecutionError(`exit_${code ?? 'signal'}`, 'Claude Code request failed'))
        try {
          const sessionId = findSessionId(events)
          if (resumeSessionId && sessionId !== resumeSessionId) {
            throw new Error('Claude Code changed the resumed session id')
          }
          finish(null, {
            text: findResultText(events),
            sessionId,
            usage: collectUsage(events),
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
