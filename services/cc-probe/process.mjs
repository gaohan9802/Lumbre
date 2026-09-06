import { spawn } from 'node:child_process'

/**
 * @typedef {object} ProcessOptions
 * @property {string} command
 * @property {string[]} [args]
 * @property {string} cwd
 * @property {Record<string, string | undefined>} env
 * @property {string} [stdin]
 * @property {number} timeoutMs
 * @property {number} maxOutputBytes
 */

/** @param {ProcessOptions} options */
export function runProcess({
  command,
  args = [],
  cwd,
  env,
  stdin = '',
  timeoutMs,
  maxOutputBytes,
}) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    let outputBytes = 0
    let timedOut = false
    let outputLimited = false
    let settled = false
    let forceKillTimer

    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    /** @param {'timeout' | 'output'} reason */
    const stop = reason => {
      if (reason === 'timeout') timedOut = true
      if (reason === 'output') outputLimited = true
      child.kill('SIGTERM')
      if (!forceKillTimer) {
        forceKillTimer = setTimeout(() => child.kill('SIGKILL'), 1_000)
        forceKillTimer.unref()
      }
    }

    const timer = setTimeout(() => stop('timeout'), timeoutMs)
    timer.unref()

    /** @param {string} target @param {string} chunk */
    const capture = (target, chunk) => {
      const bytes = Buffer.byteLength(chunk)
      outputBytes += bytes
      if (outputBytes > maxOutputBytes) {
        stop('output')
        return target
      }
      return target + chunk
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout = capture(stdout, chunk) })
    child.stderr.on('data', chunk => { stderr = capture(stderr, chunk) })

    child.on('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      reject(error)
    })

    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (forceKillTimer) clearTimeout(forceKillTimer)
      resolve({ code, signal, stdout, stderr, timedOut, outputLimited })
    })

    child.stdin.on('error', () => {})
    child.stdin.end(stdin)
  })
}
