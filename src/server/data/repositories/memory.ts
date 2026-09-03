/** Filesystem-only repository for memory buckets and brain configuration. */
import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from '../config'
import { DataCorruptionError, DataFileNotFoundError } from '../errors'
import { readJsonFile, removeJsonFile, updateJsonFile, writeJsonFile } from '../json-file'
import { withFileLock } from '../lock'
import { assertIdentifier, resolveDataPath } from '../safe-path'

const BUCKET_ID = /^[0-9a-f]{12}$/i
const DATA_DIR = getDataDir()
const BUCKETS_DIR = resolveDataPath(DATA_DIR, 'buckets')
const INDEX_FILE = resolveDataPath(BUCKETS_DIR, '_index.json')
const CONFIG_FILE = resolveDataPath(DATA_DIR, 'brain-config.json')
const SEED_LOCK = resolveDataPath(DATA_DIR, '.memory-seed')

export function memoryBucketId(id: string): string {
  return assertIdentifier(id, BUCKET_ID, 'memory bucket id')
}

function bucketFile(id: string): string {
  return resolveDataPath(BUCKETS_DIR, `${memoryBucketId(id)}.json`)
}

export function ensureMemoryDirectory(): void {
  fs.mkdirSync(BUCKETS_DIR, { recursive: true })
}

export function listMemoryBucketIds(): string[] {
  ensureMemoryDirectory()
  return fs.readdirSync(BUCKETS_DIR)
    .filter(file => /^[0-9a-f]{12}\.json$/i.test(file))
    .map(file => file.slice(0, -'.json'.length))
}

export function readMemoryBucket(id: string): unknown | null {
  try { return readJsonFile(bucketFile(id)) } catch (error) {
    if (error instanceof DataFileNotFoundError || error instanceof DataCorruptionError) return null
    throw error
  }
}

export function writeMemoryBucket(id: string, value: unknown): void {
  writeJsonFile(bucketFile(id), value)
}

export function updateMemoryBucket<T>(
  id: string,
  normalize: (value: unknown) => T | null,
  update: (current: T) => T,
): T | null {
  try {
    let result: T | null = null
    updateJsonFile<unknown>(bucketFile(id), {}, raw => {
      const current = normalize(raw)
      if (!current) throw new DataCorruptionError(bucketFile(id), 'Memory bucket has an invalid structure')
      result = update(current)
      return result
    })
    return result
  } catch (error) {
    if (error instanceof DataFileNotFoundError) return null
    throw error
  }
}

export function removeMemoryBucket(id: string): boolean {
  return removeJsonFile(bucketFile(id))
}

export function writeMemoryIndex(value: unknown): void {
  writeJsonFile(INDEX_FILE, value)
}

export function readMemoryConfig<T>(): T {
  return readJsonFile(CONFIG_FILE, {
    fallback: () => ({} as T),
    fallbackOnInvalid: true,
    validate: value => !!value && typeof value === 'object' && !Array.isArray(value),
  })
}

export function writeMemoryConfig(value: unknown): void {
  writeJsonFile(CONFIG_FILE, value)
}

export function memoryDirectoryPath(): string {
  return BUCKETS_DIR
}

export function memoryDirectoryMtime(): number {
  ensureMemoryDirectory()
  return fs.statSync(BUCKETS_DIR).mtimeMs
}

export function memoryDirectorySize(): number {
  ensureMemoryDirectory()
  let total = 0
  for (const file of fs.readdirSync(BUCKETS_DIR)) {
    try { total += fs.statSync(resolveDataPath(BUCKETS_DIR, file)).size } catch {}
  }
  return total
}

export function seedMemoryBucketsIfSparse(): void {
  ensureMemoryDirectory()
  withFileLock(SEED_LOCK, () => {
    if (listMemoryBucketIds().length >= 100) return
    const candidates = [
      resolveDataPath(DATA_DIR, 'buckets.json'),
      path.join(process.cwd(), 'src', 'seed', 'buckets.json'),
      path.join(__dirname, '..', '..', '..', 'seed', 'buckets.json'),
    ]
    const seedPath = candidates.find(candidate => fs.existsSync(candidate))
    if (!seedPath) return
    try {
      const records = readJsonFile<unknown[]>(seedPath, { validate: Array.isArray })
      let written = 0
      for (const record of records) {
        const id = (record as any)?.id
        if (typeof id !== 'string' || !BUCKET_ID.test(id)) continue
        writeMemoryBucket(id, record)
        written += 1
      }
      console.log(`[memory-repository] Seeded ${written} buckets from ${seedPath}`)
    } catch (error) {
      console.error('[memory-repository] Failed to seed buckets:', error)
    }
  })
}
