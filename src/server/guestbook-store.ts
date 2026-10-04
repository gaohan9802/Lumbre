import { randomUUID } from 'node:crypto'
import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { resolveDataPath } from './data/safe-path'

export type GuestbookActor = 'fire' | 'star' | 'guest'

export interface GuestbookReply {
  id: string
  author: GuestbookActor
  content: string
  created_at: string
  reply_to?: string
  reply_to_author?: GuestbookActor
  deleted?: boolean
}

export interface GuestbookMessage extends GuestbookReply {
  replies: GuestbookReply[]
}

interface GuestbookData {
  guest_name: string | null
  messages: GuestbookMessage[]
  seen_ids?: Partial<Record<GuestbookActor, string[]>>
}

const FILE = resolveDataPath(getDataDir(), 'guestbook', 'board.json')
const fallback = (): GuestbookData => ({ guest_name: null, messages: [], seen_ids: {} })

function isData(value: unknown): value is GuestbookData {
  const data = value as Partial<GuestbookData> | null
  return !!data && typeof data === 'object'
    && (data.guest_name === null || typeof data.guest_name === 'string')
    && Array.isArray(data.messages)
    && (data.seen_ids === undefined || (!!data.seen_ids && typeof data.seen_ids === 'object'
      && Object.values(data.seen_ids).every(ids => Array.isArray(ids) && ids.every(id => typeof id === 'string'))))
}

function read(): GuestbookData {
  const options = { fallback, fallbackOnInvalid: true, validate: isData }
  const data = readJsonFile(FILE, options)
  if (!data.messages.some(message => message.deleted || message.replies.some(reply => reply.deleted))) return data
  return updateJsonFile<GuestbookData>(FILE, options, current => ({
    ...current,
    messages: current.messages
      .filter(message => !message.deleted)
      .map(message => ({ ...message, replies: message.replies.filter(reply => !reply.deleted) })),
  }))
}

function actor(value: unknown): GuestbookActor {
  if (value === 'fire' || value === 'star' || value === 'guest') return value
  throw new Error('invalid guestbook actor')
}

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new Error(`${label}不能为空`)
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (!cleaned) throw new Error(`${label}不能为空`)
  if (cleaned.length > max) throw new Error(`${label}不能超过 ${max} 个字`)
  return cleaned
}

export function guestbookStatus(): { claimed: boolean } {
  return { claimed: !!read().guest_name }
}

export function claimGuestNickname(value: unknown): string {
  const nickname = text(value, '昵称', 24)
  let saved = nickname
  updateJsonFile<GuestbookData>(FILE, { fallback, fallbackOnInvalid: true, validate: isData }, data => {
    saved = data.guest_name || nickname
    return { ...data, guest_name: saved }
  })
  return saved
}

export function readGuestbook(limit = 100): { guest_name: string | null; messages: GuestbookMessage[] } {
  const data = read()
  const count = Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : 100
  return { guest_name: data.guest_name, messages: data.messages.slice(-count).reverse() }
}

function itemIds(data: GuestbookData): string[] {
  return data.messages.flatMap(message => [message.id, ...message.replies.map(reply => reply.id)])
}

export function guestbookUnreadCount(viewerValue: unknown): number {
  const viewer = actor(viewerValue)
  const data = read()
  const seenSet = new Set(data.seen_ids?.[viewer] || [])
  return data.messages.reduce((count, message) => count
    + (message.author !== viewer && !seenSet.has(message.id) ? 1 : 0)
    + message.replies.filter(reply => reply.author !== viewer && !seenSet.has(reply.id)).length, 0)
}

export function markGuestbookRead(viewerValue: unknown): void {
  const viewer = actor(viewerValue)
  updateJsonFile<GuestbookData>(FILE, { fallback, fallbackOnInvalid: true, validate: isData }, data => ({
    ...data,
    seen_ids: { ...data.seen_ids, [viewer]: itemIds(data) },
  }))
}

export function writeGuestbookMessage(authorValue: unknown, contentValue: unknown, replyTo?: unknown, replyToReply?: unknown): GuestbookMessage | GuestbookReply {
  const author = actor(authorValue)
  const content = text(contentValue, '留言', 2000)
  const created_at = new Date().toISOString()
  let saved: GuestbookMessage | GuestbookReply | undefined

  updateJsonFile<GuestbookData>(FILE, { fallback, fallbackOnInvalid: true, validate: isData }, data => {
    if (replyTo) {
      const message = data.messages.find(item => item.id === replyTo)
      if (!message) throw new Error('找不到要回复的留言')
      const target = replyToReply ? message.replies.find(item => item.id === replyToReply) : message
      if (!target) throw new Error('找不到要回复的这句话')
      const reply: GuestbookReply = {
        id: randomUUID(), author, content, created_at,
        reply_to: target.id,
        reply_to_author: target.author,
      }
      message.replies.push(reply)
      saved = reply
    } else {
      const message: GuestbookMessage = { id: randomUUID(), author, content, created_at, replies: [] }
      data.messages.push(message)
      saved = message
    }
    return data
  })

  return saved!
}

export function deleteGuestbookMessage(authorValue: unknown, messageId: unknown, replyId?: unknown): 'ok' | 'not_found' | 'forbidden' {
  const author = actor(authorValue)
  if (typeof messageId !== 'string' || !messageId) return 'not_found'
  let result: 'ok' | 'not_found' | 'forbidden' = 'not_found'

  updateJsonFile<GuestbookData>(FILE, { fallback, fallbackOnInvalid: true, validate: isData }, data => {
    const messageIndex = data.messages.findIndex(item => item.id === messageId)
    if (messageIndex < 0) return data
    const message = data.messages[messageIndex]
    if (typeof replyId === 'string' && replyId) {
      const replyIndex = message.replies.findIndex(item => item.id === replyId)
      if (replyIndex < 0) return data
      if (message.replies[replyIndex].author !== author) {
        result = 'forbidden'
        return data
      }
      message.replies.splice(replyIndex, 1)
    } else if (message.author !== author) {
      result = 'forbidden'
      return data
    } else {
      data.messages.splice(messageIndex, 1)
    }
    result = 'ok'
    return data
  })

  return result
}
