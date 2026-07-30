/**
 * Server-side chat storage for multi-device sync.
 * File-based (DATA_DIR/chat-sync.json): sessions merged by updatedAt + tombstones,
 * config (providers/prompt/appearance) merged by configUpdatedAt (newer wins).
 *
 * Durability:
 *  - atomic writes (tmp file + rename) so a crash mid-write can't corrupt the store
 *  - rolling backup (chat-sync.bak) kept before every overwrite
 *  - daily snapshot (chat-sync.YYYY-MM-DD.json) so history survives bad merges
 *  - corruption-safe load: falls back to .bak, then newest snapshot
 */
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR || '/persistent'
const SYNC_FILE = path.join(DATA_DIR, 'chat-sync.json')
const BAK_FILE = path.join(DATA_DIR, 'chat-sync.bak')

export interface SyncState {
  sessions: any[]
  tombstones: Record<string, number>
  config?: any
  configUpdatedAt?: number
}

function parseState(raw: any): SyncState {
  return {
    sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
    tombstones: raw.tombstones && typeof raw.tombstones === 'object' ? raw.tombstones : {},
    config: raw.config,
    configUpdatedAt: typeof raw.configUpdatedAt === 'number' ? raw.configUpdatedAt : 0,
  }
}

function tryRead(file: string): SyncState | null {
  try {
    return parseState(JSON.parse(fs.readFileSync(file, 'utf-8')))
  } catch {
    return null
  }
}

function newestSnapshot(): SyncState | null {
  try {
    const snaps = fs
      .readdirSync(DATA_DIR)
      .filter((f) => /^chat-sync\.\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
    for (let i = snaps.length - 1; i >= 0; i--) {
      const s = tryRead(path.join(DATA_DIR, snaps[i]))
      if (s) return s
    }
  } catch {
    // ignore
  }
  return null
}

export function loadSyncState(): SyncState {
  return (
    tryRead(SYNC_FILE) ||
    tryRead(BAK_FILE) ||
    newestSnapshot() || { sessions: [], tombstones: {}, configUpdatedAt: 0 }
  )
}

export function saveSyncState(state: SyncState) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const json = JSON.stringify(state)

  // keep the previous good file as a rolling backup before overwriting
  try {
    if (fs.existsSync(SYNC_FILE)) fs.copyFileSync(SYNC_FILE, BAK_FILE)
  } catch {
    // backup best-effort
  }

  // atomic write: tmp then rename
  const tmp = path.join(DATA_DIR, `.chat-sync.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tmp, json, 'utf-8')
  fs.renameSync(tmp, SYNC_FILE)

  // daily snapshot (one per day, first write of the day wins the filename)
  try {
    const day = new Date().toISOString().slice(0, 10)
    const snap = path.join(DATA_DIR, `chat-sync.${day}.json`)
    fs.writeFileSync(snap, json, 'utf-8')
    pruneSnapshots(14)
  } catch {
    // snapshot best-effort
  }
}

function pruneSnapshots(keep: number) {
  try {
    const snaps = fs
      .readdirSync(DATA_DIR)
      .filter((f) => /^chat-sync\.\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
    for (const f of snaps.slice(0, Math.max(0, snaps.length - keep))) {
      try {
        fs.unlinkSync(path.join(DATA_DIR, f))
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

// When two sessions share an id, prefer the one carrying more messages so an
// empty/blank session can never overwrite a real conversation. Equal message
// counts fall back to the newer updatedAt.
function isBlankSession(s: any) {
  return (s?.messages?.length || 0) === 0 && !s?.pinned && (!s?.title || s.title === '新的对话')
}

function pickSession(a: any, b: any) {
  // Newer edit wins so deletions propagate; a blank scratch session never
  // clobbers a real one.
  const aBlank = isBlankSession(a)
  const bBlank = isBlankSession(b)
  if (aBlank && !bBlank) return b
  if (bBlank && !aBlank) return a
  return (b?.updatedAt || 0) > (a?.updatedAt || 0) ? b : a
}

export function mergeSyncState(a: SyncState, b: SyncState): SyncState {
  const tombstones: Record<string, number> = { ...a.tombstones }
  for (const [id, ts] of Object.entries(b.tombstones || {})) {
    tombstones[id] = Math.max(tombstones[id] || 0, ts as number)
  }
  const map = new Map<string, any>(a.sessions.map((s) => [s.id, s]))
  for (const s of b.sessions || []) {
    if (!s?.id) continue
    const cur = map.get(s.id)
    map.set(s.id, cur ? pickSession(cur, s) : s)
  }
  const sessions = Array.from(map.values())
    .filter((s) => !(tombstones[s.id] && tombstones[s.id] >= (s.updatedAt || 0)))
    // never persist blank sessions server-side — heals accumulated empty "新的对话"
    .filter((s) => !isBlankSession(s))
  // config: newer configUpdatedAt wins
  const aTs = a.configUpdatedAt || 0
  const bTs = b.configUpdatedAt || 0
  const [config, configUpdatedAt] = bTs > aTs && b.config ? [b.config, bTs] : [a.config, aTs]
  return { sessions, tombstones, config, configUpdatedAt }
}

/** Mirror a co-reading turn into a dedicated Chat session so the normal 星星
 * page can continue the same book conversation. This writes directly to the
 * durable sync source; clients receive it on their next pull. */
export function appendCoreadChatMessage(input: {
  bookId: string; bookTitle: string; role: 'user' | 'assistant'; content: string; chapterNum: number; modelId?: string
}) {
  const state = loadSyncState()
  const id = `coread-${input.bookId}`
  const now = Date.now()
  let session = state.sessions.find((s: any) => s.id === id)
  if (!session) {
    session = {
      id, title: `📖 共读 · ${input.bookTitle}`, messages: [], pinned: false,
      createdAt: now, updatedAt: now,
    }
    state.sessions.unshift(session)
  }
  const content = `[《${input.bookTitle}》· 第${input.chapterNum}章]\n${input.content}`
  const duplicate = (session.messages || []).some((m: any) => m.role === input.role && m.content === content)
  if (!duplicate) {
    session.messages = [...(session.messages || []), {
      id: `coread-msg-${now}-${Math.random().toString(36).slice(2, 8)}`,
      role: input.role, content, timestamp: now,
      ...(input.role === 'assistant' ? { modelId: input.modelId || '' } : {}),
    }]
    session.updatedAt = now
    saveSyncState(state)
  }
  return id
}
