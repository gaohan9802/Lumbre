import fs from 'node:fs'
import path from 'node:path'
import { DataLockTimeoutError } from './errors'

const waitBuffer = new Int32Array(new SharedArrayBuffer(4))

export interface FileLockOptions {
  timeoutMs?: number
  retryMs?: number
  staleMs?: number
}

function pause(milliseconds: number): void {
  Atomics.wait(waitBuffer, 0, 0, milliseconds)
}

/** A cross-process lock based on atomic directory creation. */
export function withFileLock<T>(targetPath: string, operation: () => T, options: FileLockOptions = {}): T {
  const timeoutMs = options.timeoutMs ?? 5_000
  const retryMs = options.retryMs ?? 15
  const staleMs = options.staleMs ?? 30_000
  const lockPath = `${targetPath}.lock`
  const deadline = Date.now() + timeoutMs

  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  for (;;) {
    try {
      fs.mkdirSync(lockPath)
      break
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) {
          fs.rmSync(lockPath, { recursive: true, force: true })
          continue
        }
      } catch (statError: any) {
        if (statError?.code === 'ENOENT') continue
        throw statError
      }
      if (Date.now() >= deadline) throw new DataLockTimeoutError(targetPath)
      pause(Math.min(retryMs, Math.max(1, deadline - Date.now())))
    }
  }

  try {
    return operation()
  } finally {
    try { fs.rmSync(lockPath, { recursive: true, force: true }) } catch {}
  }
}
