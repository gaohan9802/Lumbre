/** Star-facing bookmark editor. Delete intentionally remains frontend-only. */
import { loadSyncManifest, mergeSyncDelta } from './chat-sync'

export interface SharedBookmark {
  id: string
  name: string
  keywords: string[]
  content: string
  position: 'start' | 'end'
  scanDepth: number
  priority: number
  alwaysOn: boolean
  enabled: boolean
}

function cleanKeywords(value: unknown): string[] {
  const items = Array.isArray(value) ? value : String(value || '').split(/[,，]/)
  return Array.from(new Set(items.map(String).map((v) => v.trim()).filter(Boolean))).slice(0, 30)
}
function normalize(input: any, id?: string): SharedBookmark {
  return {
    id: id || `bm-star-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: String(input.name || '').trim().slice(0, 120),
    keywords: cleanKeywords(input.keywords),
    content: String(input.content || '').trim().slice(0, 12000),
    position: input.position === 'start' ? 'start' : 'end',
    scanDepth: Math.max(1, Math.min(100, Number(input.scanDepth) || 4)),
    priority: Math.max(0, Math.min(999, Number(input.priority) || 50)),
    alwaysOn: !!input.alwaysOn,
    enabled: input.enabled !== false,
  }
}
export function listSharedBookmarks(): SharedBookmark[] {
  const list = loadSyncManifest().config?.bookmarks
  return Array.isArray(list) ? list.map((b: any) => normalize(b, String(b.id))).filter((b: SharedBookmark) => b.content) : []
}
function save(bookmarks: SharedBookmark[]) {
  const manifest = loadSyncManifest()
  const config = { ...(manifest.config || {}), bookmarks }
  const configUpdatedAt = Math.max(Date.now(), (manifest.configUpdatedAt || 0) + 1)
  mergeSyncDelta({ sessions: [], tombstones: manifest.tombstones, config, configUpdatedAt })
}
export function addSharedBookmark(input: any) {
  const bookmark = normalize(input)
  if (!bookmark.content) throw new Error('书签内容不能为空')
  const bookmarks = [...listSharedBookmarks(), bookmark]
  save(bookmarks)
  return bookmark
}
export function editSharedBookmark(id: string, patch: any) {
  const bookmarks = listSharedBookmarks()
  const index = bookmarks.findIndex((b) => b.id === id)
  if (index < 0) throw new Error('书签不存在')
  const next = normalize({ ...bookmarks[index], ...patch }, id)
  if (!next.content) throw new Error('书签内容不能为空')
  bookmarks[index] = next
  save(bookmarks)
  return next
}
