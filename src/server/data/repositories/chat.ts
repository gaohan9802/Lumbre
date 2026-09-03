import fs from 'node:fs'
import { getDataDir } from '../config'
import { DataCorruptionError, DataFileNotFoundError, DataPathError } from '../errors'
import { readJsonFile, removeJsonFile, writeJsonFile } from '../json-file'
import { withFileLock } from '../lock'
import { assertDateKey, resolveDataPath } from '../safe-path'

const DATA_DIR = getDataDir()
const LEGACY_FILE = resolveDataPath(DATA_DIR, 'chat-sync.json')
const LEGACY_BACKUP = resolveDataPath(DATA_DIR, 'chat-sync.bak')
const LEGACY_ARCHIVE = resolveDataPath(DATA_DIR, 'chat-sync.pre-v2.json')
const CHAT_DIR = resolveDataPath(DATA_DIR, 'chat')
const SESSIONS_DIR = resolveDataPath(CHAT_DIR, 'sessions')
const SNAPSHOTS_DIR = resolveDataPath(CHAT_DIR, 'snapshots')
const MANIFEST_FILE = resolveDataPath(CHAT_DIR, 'manifest.json')
const MANIFEST_BACKUP = resolveDataPath(CHAT_DIR, 'manifest.bak')
const STORE_LOCK_TARGET = resolveDataPath(CHAT_DIR, '.store')

export function isValidChatSessionId(id: unknown): id is string {
  return typeof id === 'string' && !!id && id.length <= 200 && !/[\0-\x1f\x7f]/.test(id)
}

function chatSessionId(id: string): string {
  if (!isValidChatSessionId(id)) {
    throw new DataPathError('Invalid chat session id')
  }
  return id
}

function encodedSessionId(id: string): string {
  return Buffer.from(chatSessionId(id)).toString('base64url')
}

function sessionFile(id: string): string {
  return resolveDataPath(SESSIONS_DIR, `${encodedSessionId(id)}.json`)
}

function sessionBackup(id: string): string {
  return resolveDataPath(SESSIONS_DIR, `${encodedSessionId(id)}.bak`)
}

function readOptionalJson(filePath: string): unknown | null {
  try { return readJsonFile(filePath) } catch (error) {
    if (error instanceof DataFileNotFoundError || error instanceof DataCorruptionError) return null
    throw error
  }
}

export function ensureChatStorage(): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
}

export function withChatStoreLock<T>(operation: () => T): T {
  return withFileLock(STORE_LOCK_TARGET, operation)
}

export function chatManifestExists(): boolean {
  return fs.existsSync(MANIFEST_FILE)
}

export function chatManifestMtime(): number | null {
  try { return fs.statSync(MANIFEST_FILE).mtimeMs } catch { return null }
}

export function readChatManifest(): unknown | null {
  return readOptionalJson(MANIFEST_FILE) || readOptionalJson(MANIFEST_BACKUP)
}

export function writeChatManifest(value: unknown, day: string): number | null {
  writeJsonFile(MANIFEST_FILE, value, { backupPath: MANIFEST_BACKUP })
  try {
    const date = assertDateKey(day, 'chat snapshot date')
    const snapshot = resolveDataPath(CHAT_DIR, `manifest.${date}.json`)
    if (!fs.existsSync(snapshot)) writeJsonFile(snapshot, value)
    const snapshots = fs.readdirSync(CHAT_DIR)
      .filter(file => /^manifest\.\d{4}-\d{2}-\d{2}\.json$/.test(file))
      .sort()
    for (const old of snapshots.slice(0, Math.max(0, snapshots.length - 14))) {
      try { fs.unlinkSync(resolveDataPath(CHAT_DIR, old)) } catch {}
    }
  } catch {}
  return chatManifestMtime()
}

export function readChatSession(id: string): unknown | null {
  return readOptionalJson(sessionFile(id)) || readOptionalJson(sessionBackup(id))
}

export function readChatSessionRecoveryCopies(id: string): unknown[] {
  const sessionId = chatSessionId(id)
  const candidates: unknown[] = []
  const backup = readOptionalJson(sessionBackup(sessionId))
  if (backup) candidates.push(backup)
  try {
    const days = fs.readdirSync(SNAPSHOTS_DIR)
      .filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day))
      .sort()
      .reverse()
    for (const day of days) {
      const snapshot = resolveDataPath(SNAPSHOTS_DIR, day, `${encodedSessionId(sessionId)}.json`)
      const value = readOptionalJson(snapshot)
      if (value) candidates.push(value)
    }
  } catch {}
  return candidates
}

export function writeChatSession(id: string, value: unknown, day: string, snapshot = true): void {
  const sessionId = chatSessionId(id)
  writeJsonFile(sessionFile(sessionId), value, { backupPath: sessionBackup(sessionId) })
  if (!snapshot) return
  try {
    const date = assertDateKey(day, 'chat snapshot date')
    const dayDirectory = resolveDataPath(SNAPSHOTS_DIR, date)
    const snapshotFile = resolveDataPath(dayDirectory, `${encodedSessionId(sessionId)}.json`)
    if (!fs.existsSync(snapshotFile)) writeJsonFile(snapshotFile, value)
    const days = fs.readdirSync(SNAPSHOTS_DIR)
      .filter(candidate => /^\d{4}-\d{2}-\d{2}$/.test(candidate))
      .sort()
    for (const old of days.slice(0, Math.max(0, days.length - 14))) {
      try { fs.rmSync(resolveDataPath(SNAPSHOTS_DIR, old), { recursive: true, force: true }) } catch {}
    }
  } catch {}
}

export function removeChatSession(id: string): boolean {
  return removeJsonFile(sessionFile(id), { backupPath: sessionBackup(id) })
}

export function readLegacyChatStates(): unknown[] {
  const candidates = [LEGACY_FILE, LEGACY_BACKUP]
  try {
    const snapshots = fs.readdirSync(DATA_DIR)
      .filter(file => /^chat-sync\.\d{4}-\d{2}-\d{2}\.json$/.test(file))
      .sort()
      .reverse()
    candidates.push(...snapshots.map(file => resolveDataPath(DATA_DIR, file)))
  } catch {}
  return candidates.flatMap(file => {
    const value = readOptionalJson(file)
    return value ? [value] : []
  })
}

export function archiveLegacyChatState(): void {
  try { fs.copyFileSync(LEGACY_FILE, LEGACY_ARCHIVE) } catch {}
}
