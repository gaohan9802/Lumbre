/**
 * Durable incremental chat storage.
 *
 * Layout (all below DATA_DIR, normally /persistent):
 *   chat/manifest.json
 *   chat/sessions/<session-id>.json
 *   chat/sessions/<session-id>.bak
 *
 * The old monolithic chat-sync.json is migrated on first access. Public
 * helpers keep the /api/sync protocol stable while avoiding full archive
 * reads and full-file rewrites for ordinary sync cycles.
 */
import fs from 'fs'
import path from 'path'
import { madridDateKey } from '@/lib/madrid-time'

const DATA_DIR = process.env.DATA_DIR || '/persistent'
const LEGACY_FILE = path.join(DATA_DIR, 'chat-sync.json')
const LEGACY_BAK = path.join(DATA_DIR, 'chat-sync.bak')
const CHAT_DIR = path.join(DATA_DIR, 'chat')
const SESSIONS_DIR = path.join(CHAT_DIR, 'sessions')
const SNAPSHOTS_DIR = path.join(CHAT_DIR, 'snapshots')
const MANIFEST_FILE = path.join(CHAT_DIR, 'manifest.json')
const MANIFEST_BAK = path.join(CHAT_DIR, 'manifest.bak')
const STORE_LOCK = path.join(CHAT_DIR, '.store-lock')

export interface SessionManifestItem {
  id: string
  updatedAt: number
  messageCount: number
  title?: string
  pinned?: boolean
  createdAt?: number
}

export interface SyncManifest {
  version: 2
  sessions: SessionManifestItem[]
  tombstones: Record<string, number>
  config?: any
  configUpdatedAt: number
}

export interface SyncState {
  sessions: any[]
  tombstones: Record<string, number>
  config?: any
  configUpdatedAt?: number
}

let manifestCache: { mtimeMs: number; value: SyncManifest } | null = null
let initialized = false

function atomicWrite(file: string, value: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tmp, value, 'utf-8')
  fs.renameSync(tmp, file)
}

/** Serialize manifest/session mutations across sync requests and Zeabur workers. */
function withStoreLock<T>(fn: () => T): T {
  fs.mkdirSync(CHAT_DIR, { recursive: true })
  const deadline = Date.now() + 5000
  while (true) {
    try {
      fs.mkdirSync(STORE_LOCK)
      fs.writeFileSync(path.join(STORE_LOCK, 'owner.json'), JSON.stringify({ pid: process.pid, at: Date.now() }))
      break
    } catch {
      try {
        const age = Date.now() - fs.statSync(STORE_LOCK).mtimeMs
        if (age > 30_000) { fs.rmSync(STORE_LOCK, { recursive: true, force: true }); continue }
      } catch {}
      if (Date.now() >= deadline) throw new Error('chat store lock timeout')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    }
  }
  try { return fn() } finally { try { fs.rmSync(STORE_LOCK, { recursive: true, force: true }) } catch {} }
}

function safeId(id: string) {
  return Buffer.from(id).toString('base64url')
}

function sessionFile(id: string) {
  return path.join(SESSIONS_DIR, `${safeId(id)}.json`)
}

function sessionBak(id: string) {
  return path.join(SESSIONS_DIR, `${safeId(id)}.bak`)
}

function emptyManifest(): SyncManifest {
  return { version: 2, sessions: [], tombstones: {}, configUpdatedAt: 0 }
}

function normalizeManifest(raw: any): SyncManifest {
  return {
    version: 2,
    sessions: Array.isArray(raw?.sessions)
      ? raw.sessions.filter((s: any) => s?.id).map((s: any) => ({
          id: String(s.id),
          updatedAt: Number(s.updatedAt) || 0,
          messageCount: Number(s.messageCount) || 0,
          title: typeof s.title === 'string' ? s.title : undefined,
          pinned: !!s.pinned,
          createdAt: Number(s.createdAt) || undefined,
        }))
      : [],
    tombstones: raw?.tombstones && typeof raw.tombstones === 'object' ? raw.tombstones : {},
    config: raw?.config,
    configUpdatedAt: Number(raw?.configUpdatedAt) || 0,
  }
}

function readJson(file: string): any | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')) } catch { return null }
}

function summaryCount(session: any) {
  return (Array.isArray(session?.summaries) ? session.summaries.length : 0)
    + (Array.isArray(session?.stageSummaries) ? session.stageSummaries.length : 0)
}

/** Recover summary metadata from the rotating backup/daily snapshots after an
 * older client accidentally uploaded an empty summary array. Message content is
 * never replaced here; only the missing summary layer is restored. */
function recoverMissingSummaries(session: any): any {
  if (!session?.id || summaryCount(session) > 0 || session?._summaryRecoveryV1) return session
  const candidates: any[] = []
  const bak = readJson(sessionBak(session.id))
  if (bak?.id === session.id) candidates.push(bak)
  try {
    const days = fs.readdirSync(SNAPSHOTS_DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse()
    for (const day of days) {
      const snap = readJson(path.join(SNAPSHOTS_DIR, day, `${safeId(session.id)}.json`))
      if (snap?.id === session.id) candidates.push(snap)
    }
  } catch {}
  const source = candidates.find(item => summaryCount(item) > 0)
  if (!source) return session
  return {
    ...session,
    summaries: Array.isArray(source.summaries) ? source.summaries : [],
    stageSummaries: Array.isArray(source.stageSummaries) ? source.stageSummaries : [],
    summaryConfig: session.summaryConfig || source.summaryConfig,
    _summaryRecoveryV1: { at: Date.now(), fromUpdatedAt: Number(source.updatedAt) || 0 },
  }
}

function isBlankSession(s: any) {
  return (s?.messages?.length || 0) === 0 && !s?.pinned && (!s?.title || s.title === '新的对话')
}

function mergeMessagesById(existing: any[], incoming: any[]) {
  const map = new Map<string, any>()
  for (const message of [...existing, ...incoming]) {
    const id = String(message?.id || '')
    if (!id) continue
    const current = map.get(id)
    map.set(id, !current || (Number(message?.timestamp) || 0) >= (Number(current?.timestamp) || 0) ? message : current)
  }
  return Array.from(map.values()).sort((a: any, b: any) => (Number(a?.timestamp) || 0) - (Number(b?.timestamp) || 0))
}

function mergeSummaryLayer(existing: any, incoming: any) {
  const aRevision = Math.max(0, Number(existing?.summaryRevision) || 0)
  const bRevision = Math.max(0, Number(incoming?.summaryRevision) || 0)
  if (bRevision > aRevision) return {
    summaries: Array.isArray(incoming?.summaries) ? incoming.summaries : [],
    stageSummaries: Array.isArray(incoming?.stageSummaries) ? incoming.stageSummaries : [],
    summaryConfig: incoming?.summaryConfig || existing?.summaryConfig,
    summaryRevision: bRevision,
  }
  if (aRevision > bRevision) return {
    summaries: Array.isArray(existing?.summaries) ? existing.summaries : [],
    stageSummaries: Array.isArray(existing?.stageSummaries) ? existing.stageSummaries : [],
    summaryConfig: existing?.summaryConfig || incoming?.summaryConfig,
    summaryRevision: aRevision,
  }
  // Equal revisions usually mean an older client updated unrelated chat data.
  // Keep the richer summary layer so 21 summaries can never fall back to 20.
  const source = summaryCount(incoming) >= summaryCount(existing) ? incoming : existing
  return {
    summaries: Array.isArray(source?.summaries) ? source.summaries : [],
    stageSummaries: Array.isArray(source?.stageSummaries) ? source.stageSummaries : [],
    summaryConfig: incoming?.summaryConfig || existing?.summaryConfig,
    summaryRevision: aRevision,
  }
}

function preserveServerWakeMessages(existing: any, incoming: any) {
  const incomingMessages = Array.isArray(incoming?.messages) ? incoming.messages : []
  const ids = new Set(incomingMessages.map((m: any) => m?.id).filter(Boolean))
  const missingWake = (Array.isArray(existing?.messages) ? existing.messages : [])
    .filter((m: any) => m?._wake && m?.id && !ids.has(m.id))
  if (!missingWake.length) return incoming
  const messages = [...incomingMessages, ...missingWake].sort((a: any, b: any) => (Number(a?.timestamp) || 0) - (Number(b?.timestamp) || 0))
  return { ...incoming, messages }
}

function pickSession(a: any, b: any) {
  const aBlank = isBlankSession(a)
  const bBlank = isBlankSession(b)
  if (aBlank && !bBlank) return b
  if (bBlank && !aBlank) return a
  if ((Number(b?.updatedAt) || 0) <= (Number(a?.updatedAt) || 0)) return a

  // A partial client session contains only the local warm tail. It must never
  // replace the complete durable file. Merge its newly-created tail by id and
  // retain server-only messages + summary metadata.
  if (b?.partial) {
    const messages = mergeMessagesById(Array.isArray(a?.messages) ? a.messages : [], Array.isArray(b?.messages) ? b.messages : [])
    return preserveServerWakeMessages(a, {
      ...a, ...b, ...mergeSummaryLayer(a, b), partial: false, messages, messageCount: messages.length,
    })
  }

  // Old/background clients occasionally submit a newer full chat without the
  // summary fields introduced later. Empty metadata must not erase a populated
  // durable summary layer merely because that client opened the conversation.
  const incoming = preserveServerWakeMessages(a, b)
  return { ...incoming, ...mergeSummaryLayer(a, incoming) }
}

function writeSession(session: any, snapshot = true) {
  const file = sessionFile(session.id)
  try { if (fs.existsSync(file)) fs.copyFileSync(file, sessionBak(session.id)) } catch {}
  const json = JSON.stringify(session)
  atomicWrite(file, json)
  // Snapshot only sessions that actually changed, once per day. This keeps the
  // old durability guarantee without copying the entire chat archive daily.
  if (snapshot) try {
    const day = madridDateKey()
    const dayDir = path.join(SNAPSHOTS_DIR, day)
    const snap = path.join(dayDir, `${safeId(session.id)}.json`)
    if (!fs.existsSync(snap)) atomicWrite(snap, json)
    const days = fs.readdirSync(SNAPSHOTS_DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
    for (const old of days.slice(0, Math.max(0, days.length - 14))) {
      try { fs.rmSync(path.join(SNAPSHOTS_DIR, old), { recursive: true, force: true }) } catch {}
    }
  } catch {}
}

function removeSession(id: string) {
  try { fs.unlinkSync(sessionFile(id)) } catch {}
}

function saveManifest(manifest: SyncManifest) {
  fs.mkdirSync(CHAT_DIR, { recursive: true })
  try { if (fs.existsSync(MANIFEST_FILE)) fs.copyFileSync(MANIFEST_FILE, MANIFEST_BAK) } catch {}
  atomicWrite(MANIFEST_FILE, JSON.stringify(manifest))
  try {
    const mtimeMs = fs.statSync(MANIFEST_FILE).mtimeMs
    manifestCache = { mtimeMs, value: manifest }
  } catch { manifestCache = null }

  // A compact daily manifest snapshot is enough to reconstruct which session
  // backups belong to the store without copying every long conversation daily.
  try {
    const day = madridDateKey()
    const snap = path.join(CHAT_DIR, `manifest.${day}.json`)
    if (!fs.existsSync(snap)) atomicWrite(snap, JSON.stringify(manifest))
    const snaps = fs.readdirSync(CHAT_DIR).filter(f => /^manifest\.\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort()
    for (const old of snaps.slice(0, Math.max(0, snaps.length - 14))) {
      try { fs.unlinkSync(path.join(CHAT_DIR, old)) } catch {}
    }
  } catch {}
}

function legacyState(): SyncState | null {
  const candidates = [LEGACY_FILE, LEGACY_BAK]
  try {
    const snaps = fs.readdirSync(DATA_DIR)
      .filter(f => /^chat-sync\.\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse()
    candidates.push(...snaps.map(f => path.join(DATA_DIR, f)))
  } catch {}
  for (const file of candidates) {
    const raw = readJson(file)
    if (raw && Array.isArray(raw.sessions)) return {
      sessions: raw.sessions,
      tombstones: raw.tombstones && typeof raw.tombstones === 'object' ? raw.tombstones : {},
      config: raw.config,
      configUpdatedAt: Number(raw.configUpdatedAt) || 0,
    }
  }
  return null
}

function ensureInitialized() {
  if (initialized && fs.existsSync(MANIFEST_FILE)) return
  fs.mkdirSync(SESSIONS_DIR, { recursive: true })
  if (!fs.existsSync(MANIFEST_FILE)) {
    const legacy = legacyState()
    if (legacy) {
      const tombstones = legacy.tombstones || {}
      const sessions = legacy.sessions
        .filter(s => s?.id && !isBlankSession(s))
        .filter(s => !(tombstones[s.id] && tombstones[s.id] >= (Number(s.updatedAt) || 0)))
      for (const session of sessions) writeSession(session, false)
      saveManifest({
        version: 2,
        sessions: sessions.map(s => ({ id: s.id, updatedAt: Number(s.updatedAt) || 0, messageCount: s.messages?.length || 0, title: s.title, pinned: !!s.pinned, createdAt: Number(s.createdAt) || 0 })),
        tombstones,
        config: legacy.config,
        configUpdatedAt: Number(legacy.configUpdatedAt) || 0,
      })
      // Keep the old archive as an untouched migration backup.
      try { fs.copyFileSync(LEGACY_FILE, path.join(DATA_DIR, 'chat-sync.pre-v2.json')) } catch {}
    } else saveManifest(emptyManifest())
  }
  initialized = true
}

export function loadSyncManifest(): SyncManifest {
  ensureInitialized()
  try {
    const mtimeMs = fs.statSync(MANIFEST_FILE).mtimeMs
    if (manifestCache?.mtimeMs === mtimeMs) return manifestCache.value
    const raw = readJson(MANIFEST_FILE) || readJson(MANIFEST_BAK)
    const value = normalizeManifest(raw)
    manifestCache = { mtimeMs, value }
    return value
  } catch {
    return normalizeManifest(readJson(MANIFEST_BAK) || emptyManifest())
  }
}

export function loadSyncSessions(ids: string[]): any[] {
  const manifest = loadSyncManifest()
  const allowed = new Set(manifest.sessions.map(s => s.id))
  const result: any[] = []
  for (const id of ids) {
    if (!allowed.has(id)) continue
    const raw = readJson(sessionFile(id)) || readJson(sessionBak(id))
    if (raw?.id === id) {
      const session = recoverMissingSummaries(raw)
      if (session !== raw) writeSession(session, false)
      result.push(session)
    }
  }
  return result
}

export function loadSyncState(): SyncState {
  const manifest = loadSyncManifest()
  return {
    sessions: loadSyncSessions(manifest.sessions.map(s => s.id)),
    tombstones: manifest.tombstones,
    config: manifest.config,
    configUpdatedAt: manifest.configUpdatedAt,
  }
}

/** Merge only submitted session files. Returns the compact resulting manifest. */
export function mergeSyncDelta(client: SyncState): SyncManifest {
  return withStoreLock(() => mergeSyncDeltaUnlocked(client))
}

function mergeSyncDeltaUnlocked(client: SyncState): SyncManifest {
  // Invalidate the process cache after waiting for another worker's lock.
  manifestCache = null
  const current = loadSyncManifest()
  const tombstones: Record<string, number> = { ...current.tombstones }
  for (const [id, ts] of Object.entries(client.tombstones || {})) {
    tombstones[id] = Math.max(tombstones[id] || 0, Number(ts) || 0)
  }

  const meta = new Map(current.sessions.map(s => [s.id, s]))
  for (const incoming of client.sessions || []) {
    if (!incoming?.id) continue
    const existingMeta = meta.get(incoming.id)
    const existing = existingMeta ? loadSyncSessions([incoming.id])[0] : null
    const winner = existing ? pickSession(existing, incoming) : incoming
    const deletedAt = tombstones[winner.id] || 0
    if (deletedAt >= (Number(winner.updatedAt) || 0) || isBlankSession(winner)) {
      meta.delete(winner.id)
      removeSession(winner.id)
      continue
    }
    // Do not rewrite an unchanged long session.
    if (!existing || winner !== existing) writeSession(winner)
    meta.set(winner.id, {
      id: winner.id,
      updatedAt: Number(winner.updatedAt) || 0,
      messageCount: winner.messages?.length || 0,
      title: winner.title, pinned: !!winner.pinned, createdAt: Number(winner.createdAt) || 0,
    })
  }

  // Apply remote deletions even when the deleted session wasn't submitted.
  for (const [id, item] of Array.from(meta.entries())) {
    if ((tombstones[id] || 0) >= item.updatedAt) {
      meta.delete(id)
      removeSession(id)
    }
  }

  const currentConfigAt = current.configUpdatedAt || 0
  const clientConfigAt = Number(client.configUpdatedAt) || 0
  const useClientConfig = clientConfigAt > currentConfigAt && client.config
  const manifest: SyncManifest = {
    version: 2,
    sessions: Array.from(meta.values()),
    tombstones,
    config: useClientConfig ? client.config : current.config,
    configUpdatedAt: useClientConfig ? clientConfigAt : currentConfigAt,
  }
  saveManifest(manifest)
  return manifest
}


/** Atomically append one message to the latest server copy of a session. */
export function appendSyncSessionMessage(sessionId: string, message: any): { appended: boolean; sessionUpdatedAt: number; messageCount: number } {
  return withStoreLock(() => {
    manifestCache = null
    const manifest = loadSyncManifest()
    const meta = manifest.sessions.find(item => item.id === sessionId)
    if (!meta) throw new Error(`wake session not found: ${sessionId}`)
    const session = readJson(sessionFile(sessionId)) || readJson(sessionBak(sessionId))
    if (!session?.id) throw new Error(`wake session unreadable: ${sessionId}`)
    const messages = Array.isArray(session.messages) ? session.messages : []
    if (messages.some((item: any) => item?.id === message?.id)) {
      return { appended: false, sessionUpdatedAt: Number(session.updatedAt) || 0, messageCount: messages.length }
    }
    const now = Math.max(Date.now(), (Number(session.updatedAt) || 0) + 1, Number(message?.timestamp) || 0)
    const updated = { ...session, messages: [...messages, message], updatedAt: now }
    writeSession(updated)
    const next: SyncManifest = {
      ...manifest,
      sessions: manifest.sessions.map(item => item.id === sessionId
        ? { id: sessionId, updatedAt: now, messageCount: updated.messages.length, title: updated.title, pinned: !!updated.pinned, createdAt: Number(updated.createdAt) || 0 }
        : item),
    }
    saveManifest(next)
    return { appended: true, sessionUpdatedAt: now, messageCount: updated.messages.length }
  })
}

/** Atomically append a browser-created message. Creates the session when this
 * is the first message, so a refresh immediately after Send cannot lose it. */
export function upsertSyncSessionMessage(sessionId: string, message: any, meta: any = {}): { appended: boolean; sessionUpdatedAt: number; messageCount: number } {
  return withStoreLock(() => {
    manifestCache = null
    const manifest = loadSyncManifest()
    const oldMeta = manifest.sessions.find(item => item.id === sessionId)
    const existing = oldMeta ? (readJson(sessionFile(sessionId)) || readJson(sessionBak(sessionId))) : null
    const base = existing?.id ? existing : {
      id: sessionId,
      title: meta.title || '新的对话',
      messages: [],
      pinned: !!meta.pinned,
      createdAt: Number(meta.createdAt) || Date.now(),
      updatedAt: 0,
      summaries: [],
      stageSummaries: [],
      summaryConfig: meta.summaryConfig,
    }
    const messages = Array.isArray(base.messages) ? base.messages : []
    if (messages.some((item: any) => item?.id === message?.id)) {
      return { appended: false, sessionUpdatedAt: Number(base.updatedAt) || 0, messageCount: messages.length }
    }
    const now = Math.max(Date.now(), (Number(base.updatedAt) || 0) + 1, Number(message?.timestamp) || 0)
    const updated = {
      ...base,
      title: meta.title || base.title,
      pinned: meta.pinned !== undefined ? !!meta.pinned : !!base.pinned,
      messages: [...messages, message],
      messageCount: messages.length + 1,
      partial: false,
      updatedAt: now,
    }
    writeSession(updated)
    const item = { id: sessionId, updatedAt: now, messageCount: updated.messages.length, title: updated.title, pinned: !!updated.pinned, createdAt: Number(updated.createdAt) || 0 }
    const next: SyncManifest = { ...manifest, sessions: oldMeta ? manifest.sessions.map(x => x.id === sessionId ? item : x) : [...manifest.sessions, item] }
    saveManifest(next)
    return { appended: true, sessionUpdatedAt: now, messageCount: updated.messages.length }
  })
}

// Legacy helpers retained for compatibility with any old server imports.
export function mergeSyncState(a: SyncState, b: SyncState): SyncState {
  const tombstones = { ...(a.tombstones || {}) }
  for (const [id, ts] of Object.entries(b.tombstones || {})) tombstones[id] = Math.max(tombstones[id] || 0, Number(ts) || 0)
  const map = new Map((a.sessions || []).map(s => [s.id, s]))
  for (const s of b.sessions || []) if (s?.id) map.set(s.id, map.has(s.id) ? pickSession(map.get(s.id), s) : s)
  const sessions = Array.from(map.values()).filter(s => !isBlankSession(s) && !((tombstones[s.id] || 0) >= (Number(s.updatedAt) || 0)))
  const useB = (Number(b.configUpdatedAt) || 0) > (Number(a.configUpdatedAt) || 0) && b.config
  return { sessions, tombstones, config: useB ? b.config : a.config, configUpdatedAt: useB ? b.configUpdatedAt : a.configUpdatedAt }
}

export function saveSyncState(state: SyncState) {
  // Full compatibility write: submit all provided sessions through v2 storage.
  mergeSyncDelta(state)
}
