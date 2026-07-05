/**
 * Server-side chat storage for multi-device sync.
 * File-based (data/chat-sync.json): sessions merged by updatedAt + tombstones,
 * config (providers/prompt/appearance) merged by configUpdatedAt (newer wins).
 */
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'src', 'data')
const SYNC_FILE = path.join(DATA_DIR, 'chat-sync.json')

export interface SyncState {
  sessions: any[]
  tombstones: Record<string, number>
  config?: any
  configUpdatedAt?: number
}

export function loadSyncState(): SyncState {
  try {
    const raw = JSON.parse(fs.readFileSync(SYNC_FILE, 'utf-8'))
    return {
      sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
      tombstones: raw.tombstones && typeof raw.tombstones === 'object' ? raw.tombstones : {},
      config: raw.config,
      configUpdatedAt: typeof raw.configUpdatedAt === 'number' ? raw.configUpdatedAt : 0,
    }
  } catch {
    return { sessions: [], tombstones: {}, configUpdatedAt: 0 }
  }
}

export function saveSyncState(state: SyncState) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(SYNC_FILE, JSON.stringify(state), 'utf-8')
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
    if (!cur || (s.updatedAt || 0) > (cur.updatedAt || 0)) map.set(s.id, s)
  }
  const sessions = Array.from(map.values()).filter(
    (s) => !(tombstones[s.id] && tombstones[s.id] >= (s.updatedAt || 0))
  )
  // config: newer configUpdatedAt wins
  const aTs = a.configUpdatedAt || 0
  const bTs = b.configUpdatedAt || 0
  const [config, configUpdatedAt] = bTs > aTs && b.config ? [b.config, bTs] : [a.config, aTs]
  return { sessions, tombstones, config, configUpdatedAt }
}
