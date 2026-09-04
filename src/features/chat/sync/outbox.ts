'use client'

import type { ChatMessage, ChatSession } from '@/features/chat/state/types'
import { createCoalescingRunner } from '@/lib/coalescingRunner'
import { chatApi } from '@/features/chat/api/client'

type SessionMeta = Pick<ChatSession, 'title' | 'pinned' | 'createdAt' | 'summaryConfig'>
type OutboxRecord = {
  key: string
  sessionId: string
  message: ChatMessage
  sessionMeta: SessionMeta
  queuedAt: number
  source?: 'idb' | 'fallback'
}

const DB_NAME = 'lumbre-chat-outbox'
const STORE_NAME = 'messages'
const FALLBACK_KEY = 'lumbre-chat-outbox-fallback'
let dbPromise: Promise<IDBDatabase> | null = null

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('无法打开消息待发箱'))
    })
  }
  return dbPromise
}

async function idbPut(record: OutboxRecord) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(record)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('消息待发箱写入失败'))
    tx.onabort = () => reject(tx.error || new Error('消息待发箱写入中止'))
  })
}

async function idbList(): Promise<OutboxRecord[]> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
    request.onsuccess = () => resolve((request.result || []).map(item => ({ ...item, source: 'idb' as const })))
    request.onerror = () => reject(request.error || new Error('消息待发箱读取失败'))
  })
}

async function idbDelete(key: string) {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('消息待发箱清理失败'))
  })
}

function fallbackList(): OutboxRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.map(item => ({ ...item, source: 'fallback' as const })) : []
  } catch { return [] }
}

function fallbackWrite(records: OutboxRecord[]) {
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(records.map(({ source: _source, ...record }) => record)))
}

/** Persist before painting the message. A browser process kill or immediate
 * PWA close can then only delay delivery, never discard the latest turn. */
export async function queueChatAppend(session: ChatSession, message: ChatMessage) {
  const record: OutboxRecord = {
    key: `${session.id}:${message.id}`,
    sessionId: session.id,
    message,
    sessionMeta: {
      title: session.title,
      pinned: session.pinned,
      createdAt: session.createdAt,
      summaryConfig: session.summaryConfig,
    },
    queuedAt: Date.now(),
  }
  try {
    await idbPut(record)
  } catch {
    const records = fallbackList().filter(item => item.key !== record.key)
    fallbackWrite([...records, record])
  }
}

async function flushOnce() {
  if (typeof navigator === 'undefined' || !navigator.onLine) return
  let records: OutboxRecord[] = fallbackList()
  try { records = [...records, ...await idbList()] } catch { /* localStorage fallback remains usable */ }
  records.sort((a, b) => a.queuedAt - b.queuedAt)

  for (const record of records) {
    await chatApi.appendMessage(record.sessionId, record.message, record.sessionMeta)
    if (record.source === 'fallback') {
      fallbackWrite(fallbackList().filter(item => item.key !== record.key))
    } else {
      await idbDelete(record.key)
    }
  }
}

// A message can be queued after an active flush has already read its snapshot.
// Coalescing guarantees that such a message triggers one follow-up pass instead
// of waiting for a later timer, focus event, or page reload.
export const flushChatOutbox = createCoalescingRunner(flushOnce)
