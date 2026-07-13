/**
 * Local file-based storage for the 2026 wishlist (愿望清单).
 * Single JSON file: DATA_DIR/wishlist/wishlist.json
 *
 * Model:
 * - Each wish belongs to one author's column:
 *     'star' (🐆, AI) or 'fire' (🦦, user).
 * - priority: 'want'(想要) / 'really'(很想要) / 'dying'(死了都要)
 * - status:   'wishing'(许愿中) / 'doing'(进行中) / 'done'(已实现)
 *   Done wishes are never deleted — they sink to the bottom / achievement wall.
 * - likes: list of who clicked "我也想要" ('star' | 'fire').
 * - comments: free-form notes from either side.
 */
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR || '/persistent'
const WISH_DIR = path.join(DATA_DIR, 'wishlist')
const WISH_FILE = path.join(WISH_DIR, 'wishlist.json')

function ensureDir() {
  fs.mkdirSync(WISH_DIR, { recursive: true })
}

export type WishPriority = 'want' | 'really' | 'dying'
export type WishStatus = 'wishing' | 'doing' | 'done'

export interface WishComment {
  id: string
  author: string // 'star' | 'fire'
  content: string
  time: string
}

export interface Wish {
  id: string
  author: string // 'star' | 'fire' — which column
  title: string
  desc?: string
  priority: WishPriority
  status: WishStatus
  likes: string[] // ['star' | 'fire']
  comments: WishComment[]
  created_at: string
  updated_at: string
}

export interface WishState {
  wishes: Wish[]
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(16).slice(2, 6)
}

const PRIORITIES: WishPriority[] = ['want', 'really', 'dying']
const STATUSES: WishStatus[] = ['wishing', 'doing', 'done']

function normPriority(p: any): WishPriority {
  return PRIORITIES.includes(p) ? p : 'want'
}
function normStatus(s: any): WishStatus {
  return STATUSES.includes(s) ? s : 'wishing'
}
function normAuthor(a: any): string {
  return a === 'star' ? 'star' : 'fire'
}

function readState(): WishState {
  ensureDir()
  try {
    const raw = JSON.parse(fs.readFileSync(WISH_FILE, 'utf-8'))
    return { wishes: Array.isArray(raw.wishes) ? raw.wishes : [] }
  } catch {
    return { wishes: [] }
  }
}

function saveState(s: WishState) {
  ensureDir()
  fs.writeFileSync(WISH_FILE, JSON.stringify(s, null, 2), 'utf-8')
}

export function getWishes(): WishState {
  return readState()
}

export function addWish(
  author: string,
  title: string,
  opts: { desc?: string; priority?: WishPriority } = {}
): Wish {
  const s = readState()
  const now = new Date().toISOString()
  const wish: Wish = {
    id: genId(),
    author: normAuthor(author),
    title: title.trim() || '一个愿望',
    desc: opts.desc?.trim() || undefined,
    priority: normPriority(opts.priority),
    status: 'wishing',
    likes: [],
    comments: [],
    created_at: now,
    updated_at: now,
  }
  s.wishes.push(wish)
  saveState(s)
  return wish
}

export function editWish(
  id: string,
  patch: { title?: string; desc?: string; priority?: WishPriority; status?: WishStatus }
): string {
  const s = readState()
  const w = s.wishes.find((x) => x.id === id)
  if (!w) return 'not_found'
  if (typeof patch.title === 'string' && patch.title.trim()) w.title = patch.title.trim()
  if (typeof patch.desc === 'string') w.desc = patch.desc.trim() || undefined
  if (patch.priority && PRIORITIES.includes(patch.priority)) w.priority = patch.priority
  if (patch.status && STATUSES.includes(patch.status)) w.status = patch.status
  w.updated_at = new Date().toISOString()
  saveState(s)
  return 'ok'
}

export function deleteWish(id: string): string {
  const s = readState()
  const before = s.wishes.length
  s.wishes = s.wishes.filter((x) => x.id !== id)
  if (s.wishes.length === before) return 'not_found'
  saveState(s)
  return 'ok'
}

/** Toggle a "我也想要" like from `who` on a wish. */
export function likeWish(id: string, who: string): string {
  const s = readState()
  const w = s.wishes.find((x) => x.id === id)
  if (!w) return 'not_found'
  const person = normAuthor(who)
  if (!Array.isArray(w.likes)) w.likes = []
  const idx = w.likes.indexOf(person)
  if (idx >= 0) w.likes.splice(idx, 1)
  else w.likes.push(person)
  w.updated_at = new Date().toISOString()
  saveState(s)
  return 'ok'
}

export function commentWish(id: string, author: string, content: string): string {
  if (!content.trim()) return 'empty'
  const s = readState()
  const w = s.wishes.find((x) => x.id === id)
  if (!w) return 'not_found'
  if (!Array.isArray(w.comments)) w.comments = []
  w.comments.push({
    id: genId(),
    author: normAuthor(author),
    content: content.trim(),
    time: new Date().toISOString(),
  })
  w.updated_at = new Date().toISOString()
  saveState(s)
  return 'ok'
}
