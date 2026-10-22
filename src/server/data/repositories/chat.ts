import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
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
const SESSION_CHUNKS_DIR = resolveDataPath(CHAT_DIR, 'session-chunks')
const SNAPSHOTS_DIR = resolveDataPath(CHAT_DIR, 'snapshots')
const MANIFEST_FILE = resolveDataPath(CHAT_DIR, 'manifest.json')
const MANIFEST_BACKUP = resolveDataPath(CHAT_DIR, 'manifest.bak')
const STORE_LOCK_TARGET = resolveDataPath(CHAT_DIR, '.store')
const MESSAGE_CHUNK_SIZE = 256

interface MessageStoreDescriptor {
  version: 1
  generation: string
  chunkSize: number
  chunkCount: number
  messageCount: number
  ids: string[]
}

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

function sessionChunksDirectory(id: string): string {
  return resolveDataPath(SESSION_CHUNKS_DIR, encodedSessionId(id))
}

function sessionGenerationDirectory(id: string, generation: string): string {
  return resolveDataPath(sessionChunksDirectory(id), generation)
}

function sessionChunkFile(id: string, generation: string, index: number): string {
  return resolveDataPath(sessionGenerationDirectory(id, generation), `${String(index).padStart(6, '0')}.json`)
}

function readOptionalJson(filePath: string): unknown | null {
  try { return readJsonFile(filePath) } catch (error) {
    if (error instanceof DataFileNotFoundError || error instanceof DataCorruptionError) return null
    throw error
  }
}

export function ensureChatStorage(): void {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
  fs.mkdirSync(SESSION_CHUNKS_DIR, { recursive: true })
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

function sessionHeader(id: string): any | null {
  return readOptionalJson(sessionFile(id)) || readOptionalJson(sessionBackup(id))
}

function messageStore(value: any): MessageStoreDescriptor | null {
  const store = value?._messageStore
  return store?.version === 1 && Number.isInteger(store.chunkSize) && store.chunkSize > 0
    && typeof store.generation === 'string' && /^[a-f0-9-]+$/.test(store.generation)
    && Number.isInteger(store.chunkCount) && store.chunkCount >= 0
    && Number.isInteger(store.messageCount) && store.messageCount >= 0
    && Array.isArray(store.ids)
    ? store as MessageStoreDescriptor : null
}

function readChunk(id: string, store: MessageStoreDescriptor, index: number): any[] {
  const file = sessionChunkFile(id, store.generation, index)
  const primary = readOptionalJson(file)
  if (Array.isArray(primary)) return primary
  const backup = readOptionalJson(`${file}.bak`)
  if (Array.isArray(backup)) return backup
  throw new DataCorruptionError(file, 'Chat message chunk is missing or invalid')
}

function snapshotSegmentedSession(id: string, stored: any, day: string): void {
  try {
    const date = assertDateKey(day, 'chat snapshot date')
    const dayDirectory = resolveDataPath(SNAPSHOTS_DIR, date)
    const snapshotFile = resolveDataPath(dayDirectory, `${encodedSessionId(id)}.json`)
    if (!fs.existsSync(snapshotFile)) {
      const chunkSnapshotDirectory = resolveDataPath(dayDirectory, encodedSessionId(id))
      fs.mkdirSync(chunkSnapshotDirectory, { recursive: true })
      const store = messageStore(stored)
      for (let index = 0; store && index < store.chunkCount; index++) {
        const source = sessionChunkFile(id, store.generation, index)
        const target = resolveDataPath(chunkSnapshotDirectory, `${String(index).padStart(6, '0')}.json`)
        try { fs.linkSync(source, target) } catch { fs.copyFileSync(source, target) }
      }
      writeJsonFile(snapshotFile, stored)
    }
    const days = fs.readdirSync(SNAPSHOTS_DIR)
      .filter(candidate => /^\d{4}-\d{2}-\d{2}$/.test(candidate))
      .sort()
    for (const old of days.slice(0, Math.max(0, days.length - 14))) {
      try { fs.rmSync(resolveDataPath(SNAPSHOTS_DIR, old), { recursive: true, force: true }) } catch {}
    }
  } catch {}
}

function hydrateSession(id: string, header: any): any {
  const store = messageStore(header)
  if (!store) return header
  const messages: any[] = []
  for (let index = 0; index < store.chunkCount; index++) messages.push(...readChunk(id, store, index))
  const { _messageStore: _store, ...metadata } = header
  return { ...metadata, messages: messages.slice(0, store.messageCount), messageCount: store.messageCount, partial: false }
}

export function readChatSession(id: string): unknown | null {
  const header = sessionHeader(id)
  return header ? hydrateSession(id, header) : null
}

export function readChatSessionHeader(id: string): any | null {
  return sessionHeader(id)
}

export function readChatSessionTail(id: string, requestedLimit: number): any | null {
  const header = sessionHeader(id)
  if (!header) return null
  const store = messageStore(header)
  if (!store) return header
  const limit = Math.max(0, Math.min(store.messageCount, Math.floor(requestedLimit) || 0))
  const start = store.messageCount - limit
  const firstChunk = Math.floor(start / store.chunkSize)
  const messages: any[] = []
  for (let index = firstChunk; index < store.chunkCount; index++) messages.push(...readChunk(id, store, index))
  const { _messageStore: _store, ...metadata } = header
  return { ...metadata, messages: messages.slice(start - firstChunk * store.chunkSize, start - firstChunk * store.chunkSize + limit), messageCount: store.messageCount, partial: start > 0 }
}

export function readChatSessionPage(id: string, requestedBefore: number, requestedLimit: number): { messages: any[]; start: number; total: number } | null {
  const header = sessionHeader(id)
  if (!header) return null
  const store = messageStore(header)
  const messages = Array.isArray(header.messages) ? header.messages : []
  const total = store?.messageCount ?? messages.length
  const before = Math.max(0, Math.min(total, Math.floor(requestedBefore) || 0))
  const limit = Math.max(0, Math.floor(requestedLimit) || 0)
  const start = Math.max(0, before - limit)
  if (!store) return { messages: messages.slice(start, before), start, total }
  if (start === before) return { messages: [], start, total }
  const firstChunk = Math.floor(start / store.chunkSize)
  const lastChunk = Math.floor((before - 1) / store.chunkSize)
  const page: any[] = []
  for (let index = firstChunk; index <= lastChunk; index++) page.push(...readChunk(id, store, index))
  return { messages: page.slice(start - firstChunk * store.chunkSize, before - firstChunk * store.chunkSize), start, total }
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
  const session = value as any
  const messages = Array.isArray(session?.messages) ? session.messages : []
  const generation = randomUUID()
  const chunks = Array.from({ length: Math.ceil(messages.length / MESSAGE_CHUNK_SIZE) }, (_, index) =>
    messages.slice(index * MESSAGE_CHUNK_SIZE, (index + 1) * MESSAGE_CHUNK_SIZE))
  fs.mkdirSync(sessionGenerationDirectory(sessionId, generation), { recursive: true })
  for (let index = 0; index < chunks.length; index++) writeJsonFile(sessionChunkFile(sessionId, generation, index), chunks[index])
  const { messages: _messages, partial: _partial, ...metadata } = session || {}
  const stored = {
    ...metadata,
    messageCount: messages.length,
    _messageStore: {
      version: 1,
      generation,
      chunkSize: MESSAGE_CHUNK_SIZE,
      chunkCount: chunks.length,
      messageCount: messages.length,
      ids: messages.map((message: any) => String(message?.id || '')),
    } satisfies MessageStoreDescriptor,
  }
  writeJsonFile(sessionFile(sessionId), stored, { backupPath: sessionBackup(sessionId) })
  const backupStore = messageStore(readOptionalJson(sessionBackup(sessionId)))
  const retained = new Set([generation, backupStore?.generation].filter(Boolean))
  try {
    for (const candidate of fs.readdirSync(sessionChunksDirectory(sessionId))) {
      if (!retained.has(candidate)) fs.rmSync(resolveDataPath(sessionChunksDirectory(sessionId), candidate), { recursive: true, force: true })
    }
  } catch {}
  if (!snapshot) return
  snapshotSegmentedSession(sessionId, stored, day)
}

export function appendChatSessionMessage(id: string, message: any, metadata: any, day: string, snapshot = true): boolean {
  const sessionId = chatSessionId(id)
  const current = sessionHeader(sessionId)
  const store = messageStore(current)
  if (!current || !store) throw new Error('chat session is not segmented')
  const messageId = String(message?.id || '')
  if (!messageId || store.ids.includes(messageId)) return false
  const chunkIndex = Math.floor(store.messageCount / store.chunkSize)
  const chunk = store.messageCount % store.chunkSize === 0 ? [] : readChunk(sessionId, store, chunkIndex)
  const alreadyWritten = chunk.some(item => String(item?.id || '') === messageId)
  if (!alreadyWritten) writeJsonFile(sessionChunkFile(sessionId, store.generation, chunkIndex), [...chunk, message])
  const nextStore: MessageStoreDescriptor = {
    ...store,
    chunkCount: Math.max(store.chunkCount, chunkIndex + 1),
    messageCount: store.messageCount + 1,
    ids: [...store.ids, messageId],
  }
  const { messages: _messages, partial: _partial, _messageStore: _oldStore, ...patch } = metadata || {}
  const stored = { ...current, ...patch, messageCount: nextStore.messageCount, _messageStore: nextStore }
  writeJsonFile(sessionFile(sessionId), stored, { backupPath: sessionBackup(sessionId) })
  if (snapshot) snapshotSegmentedSession(sessionId, stored, day)
  return true
}

export function removeChatSession(id: string): boolean {
  // Keep chunks beside the metadata backup so a mistaken deletion remains recoverable.
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
