import fs from 'node:fs'
import path from 'node:path'

const waitBuffer = new Int32Array(new SharedArrayBuffer(4))

function pause(milliseconds) {
  Atomics.wait(waitBuffer, 0, 0, milliseconds)
}

function temporaryPath(filePath) {
  return `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
}

export function assertGatewayDataDir(value) {
  if (!value || !path.isAbsolute(value)) throw new Error('CC_GATEWAY_DATA_DIR must be an absolute path')
  const resolved = path.resolve(value)
  if (resolved === '/persistent' || resolved.startsWith('/persistent/')) {
    throw new Error('CC gateway data must not use the Lumbre production volume')
  }
  return resolved
}

export function withFileLock(targetPath, operation, options = {}) {
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
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      try {
        if (Date.now() - fs.statSync(lockPath).mtimeMs > staleMs) {
          fs.rmSync(lockPath, { recursive: true, force: true })
          continue
        }
      } catch (statError) {
        if (statError?.code === 'ENOENT') continue
        throw statError
      }
      if (Date.now() >= deadline) throw new Error('Timed out waiting for CC gateway data lock')
      pause(Math.min(retryMs, Math.max(1, deadline - Date.now())))
    }
  }

  try {
    return operation()
  } finally {
    try { fs.rmSync(lockPath, { recursive: true, force: true }) } catch {}
  }
}
export function readJson(filePath, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT' && fallback !== undefined) return fallback
    throw error
  }
}

export function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const nextPath = temporaryPath(filePath)
  const backupPath = `${filePath}.bak`
  const nextBackupPath = temporaryPath(backupPath)

  try {
    fs.writeFileSync(nextPath, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, nextBackupPath)
      fs.chmodSync(nextBackupPath, 0o600)
      fs.renameSync(nextBackupPath, backupPath)
    }
    fs.renameSync(nextPath, filePath)
  } finally {
    try { fs.unlinkSync(nextPath) } catch {}
    try { fs.unlinkSync(nextBackupPath) } catch {}
  }
}
