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
import { readWishState, updateWishState } from './data/repositories/wish'

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

function emptyState(): WishState { return { wishes: [] } }

function normalizeState(raw: WishState): WishState {
  const wishes = Array.isArray(raw?.wishes)
    ? raw.wishes.filter(value => !!value && typeof value === 'object' && typeof value.id === 'string')
    : []
  return { wishes }
}

function readState(): WishState {
  return normalizeState(readWishState(emptyState))
}

function mutateState<T>(mutation: (state: WishState) => { result: T; write: boolean }): T {
  let result!: T
  updateWishState(emptyState, raw => {
    const state = normalizeState(raw)
    const outcome = mutation(state)
    result = outcome.result
    return outcome.write ? state : undefined
  })
  return result
}

export function getWishes(): WishState {
  return readState()
}

export function addWish(
  author: string,
  title: string,
  opts: { desc?: string; priority?: WishPriority } = {}
): Wish {
  return mutateState(state => {
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
    state.wishes.push(wish)
    return { result: wish, write: true }
  })
}

export function editWish(
  id: string,
  patch: { title?: string; desc?: string; priority?: WishPriority; status?: WishStatus }
): string {
  return mutateState(state => {
    const wish = state.wishes.find(value => value.id === id)
    if (!wish) return { result: 'not_found', write: false }
    if (typeof patch.title === 'string' && patch.title.trim()) wish.title = patch.title.trim()
    if (typeof patch.desc === 'string') wish.desc = patch.desc.trim() || undefined
    if (patch.priority && PRIORITIES.includes(patch.priority)) wish.priority = patch.priority
    if (patch.status && STATUSES.includes(patch.status)) wish.status = patch.status
    wish.updated_at = new Date().toISOString()
    return { result: 'ok', write: true }
  })
}

export function deleteWish(id: string): string {
  return mutateState(state => {
    const before = state.wishes.length
    state.wishes = state.wishes.filter(value => value.id !== id)
    return state.wishes.length === before
      ? { result: 'not_found', write: false }
      : { result: 'ok', write: true }
  })
}

/** Toggle a "我也想要" like from `who` on a wish. */
export function likeWish(id: string, who: string): string {
  return mutateState(state => {
    const wish = state.wishes.find(value => value.id === id)
    if (!wish) return { result: 'not_found', write: false }
    const person = normAuthor(who)
    if (!Array.isArray(wish.likes)) wish.likes = []
    const index = wish.likes.indexOf(person)
    if (index >= 0) wish.likes.splice(index, 1)
    else wish.likes.push(person)
    wish.updated_at = new Date().toISOString()
    return { result: 'ok', write: true }
  })
}

export function commentWish(id: string, author: string, content: string): string {
  if (!content.trim()) return 'empty'
  return mutateState(state => {
    const wish = state.wishes.find(value => value.id === id)
    if (!wish) return { result: 'not_found', write: false }
    if (!Array.isArray(wish.comments)) wish.comments = []
    wish.comments.push({
      id: genId(),
      author: normAuthor(author),
      content: content.trim(),
      time: new Date().toISOString(),
    })
    wish.updated_at = new Date().toISOString()
    return { result: 'ok', write: true }
  })
}
