import { spawn } from 'node:child_process'
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

export class ClaudeExecutor {
  constructor(options = {}) {
    this.binary = options.binary || 'claude'
    this.workspace = options.workspace || process.cwd()
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
    this.maxOutputBytes = options.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES
    this.env = buildProbeEnvironment(options.env || process.env)
  }

  run({ prompt, model, signal, onText }) {
    return new Promise((resolve, reject) => {
      const args = buildClaudeArgs({ outputFormat: 'stream-json', model })
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
          finish(null, {
            text: findResultText(events),
            sessionId: findSessionId(events),
            usage: collectUsage(events),
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
