import fs from 'node:fs'
import { getDataDir } from '../config'
import { DataCorruptionError, DataFileNotFoundError } from '../errors'
import { readJsonFile, updateJsonFile, writeJsonFile } from '../json-file'
import { resolveDataPath } from '../safe-path'

const DATA_DIR = getDataDir()
const LOG_FILE = resolveDataPath(DATA_DIR, 'wake-logs.json')
const CONFIG_FILE = resolveDataPath(DATA_DIR, 'wake-config.json')
const LEASE_DIR = resolveDataPath(DATA_DIR, '.wake-engine-lease')
const LEASE_FILE = resolveDataPath(LEASE_DIR, 'lease.json')

function objectValue(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function readWakeLogData(): unknown[] {
  return readJsonFile(LOG_FILE, {
    fallback: () => [],
    fallbackOnInvalid: true,
    validate: Array.isArray,
  })
}

export function appendWakeLogData(value: unknown): void {
  updateJsonFile(LOG_FILE, {
    fallback: () => [] as unknown[],
    fallbackOnInvalid: true,
    validate: Array.isArray,
  }, current => [...current, value].slice(-200))
}

export function readWakeConfigData<T>(fallback: () => T): T {
  return readJsonFile(CONFIG_FILE, { fallback, fallbackOnInvalid: true, validate: objectValue })
}

export function writeWakeConfigData(value: unknown): void {
  writeJsonFile(CONFIG_FILE, value)
}

export function updateWakeConfigData<T>(fallback: () => T, update: (current: T) => T): T {
  return updateJsonFile(CONFIG_FILE, { fallback, fallbackOnInvalid: true, validate: objectValue }, update)
}

interface WakeLease {
  token: string
  startedAt: number
  expiresAt: number
}

function readLease(): WakeLease | null {
  try {
    return readJsonFile<WakeLease>(LEASE_FILE, {
      validate: value => objectValue(value)
        && typeof (value as WakeLease).token === 'string'
        && typeof (value as WakeLease).expiresAt === 'number',
    })
  } catch (error) {
    if (error instanceof DataFileNotFoundError || error instanceof DataCorruptionError) return null
    throw error
  }
}

export function acquireWakeLeaseData(token: string, leaseMs: number, now = Date.now()): boolean {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.mkdirSync(LEASE_DIR)
      writeJsonFile(LEASE_FILE, { token, startedAt: now, expiresAt: now + leaseMs })
      return true
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error
      const lease = readLease()
      let stale = !!lease && lease.expiresAt < now
      if (!lease) {
        try { stale = now - fs.statSync(LEASE_DIR).mtimeMs > leaseMs } catch {}
      }
      if (!stale) return false
      try { fs.rmSync(LEASE_DIR, { recursive: true, force: true }) } catch { return false }
    }
  }
  return false
}

export function releaseWakeLeaseData(token: string): void {
  try {
    const lease = readLease()
    if (lease?.token === token) fs.rmSync(LEASE_DIR, { recursive: true, force: true })
  } catch {}
}
