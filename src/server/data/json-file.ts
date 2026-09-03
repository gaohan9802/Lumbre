import fs from 'node:fs'
import path from 'node:path'
import { DataCorruptionError, DataFileNotFoundError } from './errors'
import { withFileLock } from './lock'

export interface JsonReadOptions<T> {
  fallback?: () => T
  fallbackOnInvalid?: boolean
  validate?: (value: unknown) => boolean
}

function isMissing(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

export function readJsonFile<T = unknown>(filePath: string, options: JsonReadOptions<T> = {}): T {
  let text: string
  try {
    text = fs.readFileSync(filePath, 'utf8')
  } catch (error) {
    if (isMissing(error)) {
      if (options.fallback) return options.fallback()
      throw new DataFileNotFoundError(filePath)
    }
    throw error
  }

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    if (options.fallback && options.fallbackOnInvalid) return options.fallback()
    throw new DataCorruptionError(filePath, undefined, { cause: error })
  }
  if (options.validate && !options.validate(value)) {
    if (options.fallback && options.fallbackOnInvalid) return options.fallback()
    throw new DataCorruptionError(filePath, 'Data file failed structural validation')
  }
  return value as T
}

function uniqueTemporaryPath(filePath: string): string {
  return `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
}

function writeJsonUnlocked(filePath: string, value: unknown): void {
  const directory = path.dirname(filePath)
  fs.mkdirSync(directory, { recursive: true })
  const temporaryPath = uniqueTemporaryPath(filePath)
  const backupPath = `${filePath}.bak`
  const temporaryBackupPath = uniqueTemporaryPath(backupPath)

  try {
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' })
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, temporaryBackupPath)
      fs.renameSync(temporaryBackupPath, backupPath)
    }
    fs.renameSync(temporaryPath, filePath)
  } finally {
    try { fs.unlinkSync(temporaryPath) } catch {}
    try { fs.unlinkSync(temporaryBackupPath) } catch {}
  }
}

export function writeJsonFile(filePath: string, value: unknown): void {
  withFileLock(filePath, () => writeJsonUnlocked(filePath, value))
}

/** Delete a JSON file only after retaining its exact previous bytes as `.bak`. */
export function removeJsonFile(filePath: string): boolean {
  return withFileLock(filePath, () => {
    if (!fs.existsSync(filePath)) return false
    const backupPath = `${filePath}.bak`
    const temporaryBackupPath = uniqueTemporaryPath(backupPath)
    try {
      fs.copyFileSync(filePath, temporaryBackupPath)
      fs.renameSync(temporaryBackupPath, backupPath)
      fs.unlinkSync(filePath)
      return true
    } finally {
      try { fs.unlinkSync(temporaryBackupPath) } catch {}
    }
  })
}

export function updateJsonFile<T>(
  filePath: string,
  options: JsonReadOptions<T>,
  update: (current: T) => T | undefined,
): T {
  return withFileLock(filePath, () => {
    const current = readJsonFile(filePath, options)
    const next = update(current)
    if (next === undefined) return current
    writeJsonUnlocked(filePath, next)
    return next
  })
}
