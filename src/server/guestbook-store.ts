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
  deleted?: boolean
}

export interface GuestbookMessage extends GuestbookReply {
  replies: GuestbookReply[]
}

interface GuestbookData {
  guest_name: string | null
  messages: GuestbookMessage[]
}

const FILE = resolveDataPath(getDataDir(), 'guestbook', 'board.json')
const fallback = (): GuestbookData => ({ guest_name: null, messages: [] })

function isData(value: unknown): value is GuestbookData {
  const data = value as Partial<GuestbookData> | null
  return !!data && typeof data === 'object'
    && (data.guest_name === null || typeof data.guest_name === 'string')
    && Array.isArray(data.messages)
}

function read(): GuestbookData {
  return readJsonFile(FILE, { fallback, fallbackOnInvalid: true, validate: isData })
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

export function writeGuestbookMessage(authorValue: unknown, contentValue: unknown, replyTo?: unknown): GuestbookMessage | GuestbookReply {
  const author = actor(authorValue)
  const content = text(contentValue, '留言', 2000)
  const created_at = new Date().toISOString()
  let saved: GuestbookMessage | GuestbookReply | undefined

  updateJsonFile<GuestbookData>(FILE, { fallback, fallbackOnInvalid: true, validate: isData }, data => {
    if (replyTo) {
      const message = data.messages.find(item => item.id === replyTo)
      if (!message) throw new Error('找不到要回复的留言')
      if (message.deleted) throw new Error('这条留言已经被撕掉了')
      const reply: GuestbookReply = { id: randomUUID(), author, content, created_at }
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
    const message = data.messages.find(item => item.id === messageId)
    if (!message) return data
    const target = typeof replyId === 'string' && replyId
      ? message.replies.find(item => item.id === replyId)
      : message
    if (!target) return data
    if (author !== 'fire' && target.author !== author) {
      result = 'forbidden'
      return data
    }
    target.content = ''
    target.deleted = true
    result = 'ok'
    return data
  })

  return result
}
