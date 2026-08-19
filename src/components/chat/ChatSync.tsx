'use client'

/**
 * ChatSync — incremental multi-device sync.
 *
 * Startup/resume first downloads a tiny manifest, then only fetches sessions
 * that are missing or newer. Local edits are pushed as deltas and the server
 * returns only remote deltas. This avoids repeatedly parsing the full archive
 * when a conversation has hundreds or thousands of messages.
 */
import { useEffect, useRef } from 'react'
import { useChatStore, extractConfig, isBlankSession } from '@/lib/chatStore'
import { useSyncStatus } from '@/lib/syncStatus'

let applyingRemote = false
let bootstrapped = false
let inFlight: Promise<void> | null = null
let pushedSnapshot: Record<string, number> = {}
let pushedConfigAt = -1

type ManifestItem = { id: string; updatedAt: number; messageCount?: number }

async function syncFetch(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

function snapshotFromManifest(items: ManifestItem[] = []) {
  const next: Record<string, number> = {}
  for (const item of items) if (item?.id) next[item.id] = Number(item.updatedAt) || 0
  return next
}

function applyRemote(data: any) {
  applyingRemote = true
  try {
    if (Array.isArray(data?.sessions) || data?.tombstones) {
      useChatStore.getState().mergeRemote(Array.isArray(data.sessions) ? data.sessions : [], data.tombstones || {})
    }
    if (data?.config && typeof data.configUpdatedAt === 'number') {
      useChatStore.getState().mergeRemoteConfig(data.config, data.configUpdatedAt)
    }
  } finally {
    applyingRemote = false
  }
}

async function fetchSessionBatch(ids: string[]) {
  if (!ids.length) return
  const params = new URLSearchParams({ mode: 'sessions', ids: ids.join(',') })
  const res = await syncFetch(`/api/sync?${params.toString()}`)
  if (!res.ok) throw new Error(`同步请求失败 (${res.status})`)
  applyRemote(await res.json())
}

async function pullIncremental() {
  const before = useChatStore.getState().settings
  const params = new URLSearchParams({
    mode: 'manifest',
    configUpdatedAt: String(before.configUpdatedAt || 0),
  })
  const res = await syncFetch(`/api/sync?${params.toString()}`)
  if (!res.ok) throw new Error(`同步请求失败 (${res.status})`)
  const data = await res.json()
  const manifest: ManifestItem[] = Array.isArray(data.sessions) ? data.sessions : []

  // Tombstones/config are tiny and can be applied before fetching message data.
  applyRemote({ sessions: [], tombstones: data.tombstones || {}, config: data.config, configUpdatedAt: data.configUpdatedAt })

  const local = useChatStore.getState().settings.sessions
  const localMap = new Map(local.map(s => [s.id, s]))
  const needed = manifest
    .filter(remote => {
      const cur = localMap.get(remote.id)
      return !cur || cur.partial || (Number(remote.updatedAt) || 0) > (Number(cur.updatedAt) || 0)
    })
    .map(s => s.id)

  // Keep URLs modest and let the UI breathe between bounded responses.
  for (let i = 0; i < needed.length; i += 40) {
    await fetchSessionBatch(needed.slice(i, i + 40))
  }

  // On a fresh device/reload, a local blank draft must not remain selected
  // after the real sessions arrive. Resume the newest conversation once; do
  // not change selection on later background syncs.
  const hydrated = useChatStore.getState()
  const active = hydrated.settings.sessions.find(s => s.id === hydrated.settings.activeSessionId)
  if (!active || isBlankSession(active)) {
    const latest = hydrated.settings.sessions
      .filter(s => !isBlankSession(s))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (latest) hydrated.setActiveSession(latest.id)
  }

  pushedSnapshot = snapshotFromManifest(manifest)
  pushedConfigAt = Number(data.configUpdatedAt) || 0
  bootstrapped = true
}

async function syncCycle() {
  useSyncStatus.getState().setSyncStatus({ phase: navigator.onLine ? 'syncing' : 'offline', error: '' })
  if (!navigator.onLine) return
  if (!bootstrapped) await pullIncremental()

  const { settings } = useChatStore.getState()
  const syncSessions = settings.sessions.filter(s => !isBlankSession(s))
  const changed = syncSessions.filter(s => pushedSnapshot[s.id] !== s.updatedAt)
  const configAt = settings.configUpdatedAt || 0
  const configChanged = configAt !== pushedConfigAt

  if (changed.length === 0 && !configChanged) {
    await pullIncremental()
    return
  }

  const knownSessions = syncSessions.map(s => ({ id: s.id, updatedAt: s.updatedAt }))
  const res = await syncFetch('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessions: changed,
      tombstones: settings.tombstones,
      config: configChanged ? extractConfig(settings) : undefined,
      configUpdatedAt: configAt,
      responseMode: 'delta',
      knownSessions,
      knownConfigUpdatedAt: configAt,
    }),
  }, 25000)
  if (!res.ok) throw new Error(`同步请求失败 (${res.status})`)
  const data = await res.json()
  applyRemote(data)
  if (Array.isArray(data.manifest)) pushedSnapshot = snapshotFromManifest(data.manifest)
  pushedConfigAt = Number(data.configUpdatedAt) || pushedConfigAt
}

export function syncChatNow() {
  if (inFlight) return inFlight
  inFlight = syncCycle()
    .then(() => {
      if (navigator.onLine) useSyncStatus.getState().setSyncStatus({ phase: 'idle', lastSyncedAt: Date.now(), error: '' })
    })
    .catch((err: any) => {
      useSyncStatus.getState().setSyncStatus({
        phase: navigator.onLine ? 'error' : 'offline',
        error: navigator.onLine ? (err?.name === 'AbortError' ? '同步超时' : err?.message || '同步失败') : '当前离线',
      })
    })
    .finally(() => { inFlight = null })
  return inFlight
}

export function ChatSync() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    syncChatNow()
    const iv = setInterval(syncChatNow, 45000)
    const unsub = useChatStore.subscribe((state, prev) => {
      if (applyingRemote) return
      if (state.settings.sessions !== prev.settings.sessions || state.settings.configUpdatedAt !== prev.settings.configUpdatedAt) {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(syncChatNow, 1800)
      }
    })

    const resume = () => {
      if (document.visibilityState === 'visible') syncChatNow()
    }
    const offline = () => useSyncStatus.getState().setSyncStatus({ phase: 'offline', error: '当前离线' })
    window.addEventListener('online', syncChatNow)
    window.addEventListener('offline', offline)
    window.addEventListener('lumbre:sync-retry', syncChatNow)
    window.addEventListener('focus', syncChatNow)
    document.addEventListener('visibilitychange', resume)

    return () => {
      clearInterval(iv)
      unsub()
      window.removeEventListener('online', syncChatNow)
      window.removeEventListener('offline', offline)
      window.removeEventListener('lumbre:sync-retry', syncChatNow)
      window.removeEventListener('focus', syncChatNow)
      document.removeEventListener('visibilitychange', resume)
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return null
}
