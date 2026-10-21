import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { resolveDataPath } from './data/safe-path'

export const ROOM_UNREAD_KEYS = [
  'coupons', 'todo', 'notes', 'diary', 'wishlist', 'photos', 'favorites',
  'media', 'energy', 'timeline', 'poems', 'stories', 'research', 'tesis',
  'future',
] as const

export type RoomUnreadKey = typeof ROOM_UNREAD_KEYS[number]
type RoomUnreadCounts = Record<RoomUnreadKey, number>
interface RoomUnreadData { counts: Partial<RoomUnreadCounts>; updated_at: string | null }

const FILE = resolveDataPath(getDataDir(), 'room-unread.json')
const fallback = (): RoomUnreadData => ({ counts: {}, updated_at: null })

function isData(value: unknown): value is RoomUnreadData {
  const data = value as Partial<RoomUnreadData> | null
  return !!data && typeof data === 'object' && !!data.counts && typeof data.counts === 'object'
    && Object.entries(data.counts).every(([key, count]) => isRoomUnreadKey(key) && Number.isInteger(count) && Number(count) >= 0)
    && (data.updated_at === null || typeof data.updated_at === 'string')
}

const options = { fallback, fallbackOnInvalid: true, validate: isData }

export function isRoomUnreadKey(value: unknown): value is RoomUnreadKey {
  return typeof value === 'string' && ROOM_UNREAD_KEYS.includes(value as RoomUnreadKey)
}

export function readRoomUnreadCounts(): RoomUnreadCounts {
  const saved = readJsonFile(FILE, options).counts
  return Object.fromEntries(ROOM_UNREAD_KEYS.map(room => [room, saved[room] || 0])) as RoomUnreadCounts
}

export function incrementRoomUnread(room: RoomUnreadKey): number {
  let count = 0
  updateJsonFile<RoomUnreadData>(FILE, options, data => {
    count = Math.min(9_999, (data.counts[room] || 0) + 1)
    return { counts: { ...data.counts, [room]: count }, updated_at: new Date().toISOString() }
  })
  return count
}

export function markRoomRead(room: RoomUnreadKey): void {
  updateJsonFile<RoomUnreadData>(FILE, options, data => ({
    counts: { ...data.counts, [room]: 0 },
    updated_at: new Date().toISOString(),
  }))
}
