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

const DATA_DIR = process.env.DATA_DIR || '/persistent'
const LEGACY_FILE = path.join(DATA_DIR, 'chat-sync.json')
const LEGACY_BAK = path.join(DATA_DIR, 'chat-sync.bak')
const CHAT_DIR = path.join(DATA_DIR, 'chat')
const SESSIONS_DIR = path.join(CHAT_DIR, 'sessions')
const SNAPSHOTS_DIR = path.join(CHAT_DIR, 'snapshots')
const MANIFEST_FILE = path.join(CHAT_DIR, 'manifest.json')
const MANIFEST_BAK = path.join(CHAT_DIR, 'manifest.bak')

export interface SessionManifestItem {
  id: string
  updatedAt: number
  messageCount: number
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

function isBlankSession(s: any) {
  return (s?.messages?.length || 0) === 0 && !s?.pinned && (!s?.title || s.title === '新的对话')
}

function pickSession(a: any, b: any) {
  const aBlank = isBlankSession(a)
  const bBlank = isBlankSession(b)
  if (aBlank && !bBlank) return b
  if (bBlank && !aBlank) return a
  return (Number(b?.updatedAt) || 0) > (Number(a?.updatedAt) || 0) ? b : a
}

function writeSession(session: any, snapshot = true) {
  const file = sessionFile(session.id)
  try { if (fs.existsSync(file)) fs.copyFileSync(file, sessionBak(session.id)) } catch {}
  const json = JSON.stringify(session)
  atomicWrite(file, json)
  // Snapshot only sessions that actually changed, once per day. This keeps the
  // old durability guarantee without copying the entire chat archive daily.
  if (snapshot) try {
    const day = new Date().toISOString().slice(0, 10)
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
    const day = new Date().toISOString().slice(0, 10)
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
        sessions: sessions.map(s => ({ id: s.id, updatedAt: Number(s.updatedAt) || 0, messageCount: s.messages?.length || 0 })),
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
    const session = readJson(sessionFile(id)) || readJson(sessionBak(id))
    if (session?.id === id) result.push(session)
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
    if (!existing || winner === incoming) writeSession(winner)
    meta.set(winner.id, {
      id: winner.id,
      updatedAt: Number(winner.updatedAt) || 0,
      messageCount: winner.messages?.length || 0,
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
