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
import {
  completeLegacyModelCredentialMigration,
  extractConfig,
  getPendingLegacyModelCredentials,
  isBlankSession,
  useChatStore,
} from '@/lib/chatStore'
import { useSyncStatus } from '@/lib/syncStatus'
import { flushChatOutbox } from '@/lib/chat-outbox'

let applyingRemote = false
let bootstrapped = false
let inFlight: Promise<void> | null = null
let pushedSnapshot: Record<string, number> = {}
let pushedConfigAt = -1

type ManifestItem = { id: string; updatedAt: number; messageCount?: number; title?: string; pinned?: boolean; createdAt?: number }

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

async function syncModelCredentialStatus() {
  const pending = getPendingLegacyModelCredentials()
  if (pending.length) {
    const migrated = await syncFetch('/api/model-profiles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profiles: pending }),
    })
    if (!migrated.ok) throw new Error(`模型凭据迁移失败 (${migrated.status})`)
    completeLegacyModelCredentialMigration(pending.map(profile => profile.id))
  }

  const response = await syncFetch('/api/model-profiles')
  if (!response.ok) throw new Error(`模型渠道状态读取失败 (${response.status})`)
  const data = await response.json()
  const statuses = new Map((Array.isArray(data?.profiles) ? data.profiles : []).map((item: any) => [item.id, item]))
  const state = useChatStore.getState()
  let changed = false
  const apiProfiles = state.settings.apiProfiles.map(profile => {
    const status: any = statuses.get(profile.id)
    const nextConfigured = !!status?.configured
    const nextOrigin = typeof status?.upstreamOrigin === 'string' ? status.upstreamOrigin : undefined
    if (profile.credentialConfigured === nextConfigured && profile.upstreamOrigin === nextOrigin) return profile
    changed = true
    return { ...profile, credentialConfigured: nextConfigured, upstreamOrigin: nextOrigin }
  })
  if (changed) state.setSettings({ apiProfiles })
}

async function fetchSessionBatch(ids: string[]) {
  if (!ids.length) return
  const params = new URLSearchParams({ mode: 'tails', ids: ids.join(','), limit: '120' })
  const res = await syncFetch(`/api/sync?${params.toString()}`)
  if (!res.ok) throw new Error(`同步请求失败 (${res.status})`)
  applyRemote(await res.json())
}

export async function loadEarlierChat(sessionId: string) {
  const session = useChatStore.getState().settings.sessions.find(item => item.id === sessionId)
  if (!session?.partial) return 0
  const total = Math.max(Number(session.messageCount) || 0, session.messages.length)
  const before = Math.max(0, total - session.messages.length)
  if (!before) return 0
  const params = new URLSearchParams({ mode: 'history', id: sessionId, before: String(before), limit: '50' })
  const res = await syncFetch(`/api/sync?${params.toString()}`)
  if (!res.ok) throw new Error(`历史消息加载失败 (${res.status})`)
  const data = await res.json()
  const messages = Array.isArray(data.messages) ? data.messages : []
  useChatStore.getState().prependSessionMessages(sessionId, messages, Number(data.total) || total)
  return messages.length
}

async function pullIncremental() {
  const beforeState = useChatStore.getState()
  const before = beforeState.settings
  const params = new URLSearchParams({
    mode: 'manifest',
    configUpdatedAt: String(before.configUpdatedAt || 0),
  })
  const res = await syncFetch(`/api/sync?${params.toString()}`)
  if (!res.ok) throw new Error(`同步请求失败 (${res.status})`)
  const data = await res.json()
  const manifest: ManifestItem[] = Array.isArray(data.sessions) ? data.sessions : []

  applyRemote({ sessions: [], tombstones: data.tombstones || {}, config: data.config, configUpdatedAt: data.configUpdatedAt })
  // Apply the remote config before recording credential status locally. The
  // status update bumps configUpdatedAt; doing it first would make a newer
  // server config look stale on the very first upgraded load.
  await syncModelCredentialStatus()

  // Materialize lightweight manifest stubs so the session drawer is complete
  // without downloading every conversation body.
  const knownIds = new Set(useChatStore.getState().settings.sessions.map(s => s.id))
  const stubs = manifest.filter(item => !knownIds.has(item.id)).map(item => ({
    id: item.id, title: item.title || '历史对话', messages: [], pinned: !!item.pinned,
    createdAt: Number(item.createdAt) || Number(item.updatedAt) || Date.now(),
    updatedAt: Number(item.updatedAt) || 0, messageCount: Number(item.messageCount) || 0,
    partial: true,
  }))
  if (stubs.length) applyRemote({ sessions: stubs, tombstones: {} })

  const state = useChatStore.getState()
  const local = state.settings.sessions
  const localMap = new Map(local.map(s => [s.id, s]))
  const newestRemote = [...manifest].sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))[0]
  const currentActive = localMap.get(state.settings.activeSessionId)
  const preferredId = (!currentActive || isBlankSession(currentActive)) ? newestRemote?.id : currentActive.id

  // Hydrate only the conversation the user is actually entering. Previously
  // every partial 4000-message session was downloaded at boot, so the 50-row
  // render limit saved React work but not network/JSON/Zustand/localStorage work.
  if (preferredId) {
    const remote = manifest.find(item => item.id === preferredId)
    const cur = localMap.get(preferredId)
    if (remote && (!cur || cur.partial || Number(remote.updatedAt) > Number(cur.updatedAt))) {
      await fetchSessionBatch([preferredId])
    }
  }

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

async function hydrateActiveSession() {
  if (!bootstrapped || !navigator.onLine) return
  const state = useChatStore.getState()
  const active = state.settings.sessions.find(s => s.id === state.settings.activeSessionId)
  if (!active?.partial) return
  await fetchSessionBatch([active.id])
}
async function syncCycle() {
  useSyncStatus.getState().setSyncStatus({ phase: navigator.onLine ? 'syncing' : 'offline', error: '' })
  if (!navigator.onLine) return
  await flushChatOutbox()
  if (!bootstrapped) await pullIncremental()

  const { settings } = useChatStore.getState()
  const syncSessions = settings.sessions.filter(s => !isBlankSession(s))
  const changed = syncSessions.filter(s => pushedSnapshot[s.id] !== s.updatedAt && !(s.partial && pushedSnapshot[s.id] === undefined))
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
      if (state.settings.activeSessionId !== prev.settings.activeSessionId) {
        void hydrateActiveSession().catch(() => {})
      }
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
