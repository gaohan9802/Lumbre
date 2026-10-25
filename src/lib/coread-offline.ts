'use client'

import type { CoreadOfflineBundle, CoreadProgress } from './coread'
import type { MediaActor, MediaWork } from './media-library'

const DB_NAME = 'lumbre-coread-offline'
const BOOK_STORE = 'books'
const PROGRESS_STORE = 'progress'
const FALLBACK_KEY = 'lumbre-coread-progress-fallback'

export interface OfflineCoreadBook extends CoreadOfflineBundle {
  workId: string
  work: MediaWork
  downloadedAt: string
}

interface OfflineProgress extends CoreadProgress {
  key: string
  workId: string
  actor: MediaActor
  dirty: boolean
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(BOOK_STORE)) request.result.createObjectStore(BOOK_STORE, { keyPath: 'workId' })
        if (!request.result.objectStoreNames.contains(PROGRESS_STORE)) request.result.createObjectStore(PROGRESS_STORE, { keyPath: 'key' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error || new Error('无法打开离线书架'))
    })
  }
  return dbPromise
}

async function get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error || new Error('离线书架读取失败'))
  })
}

async function list<T>(store: string): Promise<T[]> {
  const db = await openDb()
  return await new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).getAll()
    request.onsuccess = () => resolve((request.result || []) as T[])
    request.onerror = () => reject(request.error || new Error('离线书架读取失败'))
  })
}

async function put(store: string, value: unknown): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('离线书架写入失败'))
    tx.onabort = () => reject(tx.error || new Error('离线书架写入中止'))
  })
}

async function remove(store: string, key: IDBValidKey): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('离线书架清理失败'))
  })
}

const progressKey = (actor: MediaActor, workId: string) => `${actor}:${workId}`
const time = (value?: CoreadProgress) => value ? Date.parse(value.updated_at) || 0 : 0

export function newestCoreadProgress(local?: CoreadProgress, remote?: CoreadProgress): CoreadProgress | undefined {
  return time(local) > time(remote) ? local : remote || local
}

function fallbackList(): OfflineProgress[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function fallbackWrite(records: OfflineProgress[]) {
  try { localStorage.setItem(FALLBACK_KEY, JSON.stringify(records)) } catch {}
}

export async function saveOfflineCoreadBook(work: MediaWork, bundle: CoreadOfflineBundle): Promise<void> {
  const prior = await get<OfflineCoreadBook>(BOOK_STORE, work.id).catch(() => undefined)
  const progress = { ...bundle.progress }
  for (const actor of ['fire', 'star'] as MediaActor[]) {
    const local = await readLocalCoreadProgress(actor, work.id)
    progress[actor] = newestCoreadProgress(local, newestCoreadProgress(prior?.progress[actor], progress[actor]))
  }
  await put(BOOK_STORE, { ...bundle, progress, workId: work.id, work, downloadedAt: new Date().toISOString() } satisfies OfflineCoreadBook)
  await prepareOfflineShell()
}

export async function getOfflineCoreadBook(workId: string): Promise<OfflineCoreadBook | undefined> {
  return await get<OfflineCoreadBook>(BOOK_STORE, workId)
}

export async function updateOfflineCoreadWork(work: MediaWork): Promise<void> {
  const stored = await get<OfflineCoreadBook>(BOOK_STORE, work.id)
  if (stored) await put(BOOK_STORE, { ...stored, work })
}

export async function listOfflineCoreadBooks(): Promise<OfflineCoreadBook[]> {
  return (await list<OfflineCoreadBook>(BOOK_STORE)).sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt))
}

export async function removeOfflineCoreadBook(workId: string): Promise<void> {
  await remove(BOOK_STORE, workId)
}

export async function readLocalCoreadProgress(actor: MediaActor, workId: string): Promise<CoreadProgress | undefined> {
  try {
    const stored = await get<OfflineProgress>(PROGRESS_STORE, progressKey(actor, workId))
    if (stored) return stored
  } catch {}
  return fallbackList().find(item => item.key === progressKey(actor, workId))
}

export async function saveLocalCoreadProgress(actor: MediaActor, workId: string, paragraph_idx: number, offset: number): Promise<CoreadProgress> {
  const progress: OfflineProgress = {
    key: progressKey(actor, workId), workId, actor, paragraph_idx, offset,
    updated_at: new Date().toISOString(), dirty: true,
  }
  try { await put(PROGRESS_STORE, progress) }
  catch {
    const rest = fallbackList().filter(item => item.key !== progress.key)
    fallbackWrite([...rest, progress])
  }
  return progress
}

export async function flushOfflineCoreadProgress(
  actor: MediaActor,
  send: (workId: string, progress: CoreadProgress) => Promise<{ progress?: CoreadProgress }>,
): Promise<void> {
  if (typeof navigator === 'undefined' || !navigator.onLine) return
  let pending = fallbackList().filter(item => item.actor === actor && item.dirty)
  try { pending = [...pending, ...(await list<OfflineProgress>(PROGRESS_STORE)).filter(item => item.actor === actor && item.dirty)] } catch {}
  const latest = new Map<string, OfflineProgress>()
  for (const item of pending) {
    const prior = latest.get(item.key)
    if (!prior || time(item) > time(prior)) latest.set(item.key, item)
  }
  for (const item of Array.from(latest.values())) {
    const result = await send(item.workId, item)
    const current = await readLocalCoreadProgress(actor, item.workId)
    if (current?.updated_at !== item.updated_at) continue
    const synced = { ...item, ...(result.progress || item), dirty: false }
    try { await put(PROGRESS_STORE, synced) } catch {}
    fallbackWrite(fallbackList().filter(value => value.key !== item.key))
    const cached = await getOfflineCoreadBook(item.workId).catch(() => undefined)
    if (cached) await put(BOOK_STORE, { ...cached, progress: { ...cached.progress, [actor]: result.progress || item } })
  }
}

export async function prepareOfflineShell(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try {
    const registration = await navigator.serviceWorker.ready
    registration.active?.postMessage({ type: 'CACHE_APP_SHELL' })
  } catch {}
}
