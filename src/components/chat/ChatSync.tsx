'use client'

/**
 * ChatSync — multi-device sync for sessions AND model/prompt/appearance config.
 * Push+pull to /api/sync on mount, every 45s, and 2.5s after local changes.
 */
import { useEffect, useRef } from 'react'
import { useChatStore, extractConfig, isBlankSession } from '@/lib/chatStore'

let applyingRemote = false

// Incremental push: remember each session's last-pushed updatedAt so a boot
// with hundreds of unchanged sessions only uploads the ones that actually
// changed. The server merge (mergeSyncState) keeps sessions it didn't receive
// untouched and deletions still propagate via tombstones (always sent), so
// sending a subset is safe and makes sync cost independent of history length.
let pushedSnapshot: Record<string, number> = {}
let pushedConfigAt = -1

async function doSync() {
  try {
    const { settings } = useChatStore.getState()
    // don't push blank scratch sessions — they'd accumulate across boots/devices
    const syncSessions = settings.sessions.filter((s) => !isBlankSession(s))
    // only push sessions whose updatedAt changed since the last successful push
    const changed = syncSessions.filter((s) => pushedSnapshot[s.id] !== s.updatedAt)
    const configAt = settings.configUpdatedAt || 0
    const configChanged = configAt !== pushedConfigAt
    // nothing local changed — skip the heavy upload, but still pull so changes
    // from other devices arrive; then re-baseline the snapshot to any sessions
    // the pull merged in, so we don't echo server-origin edits back on next push
    if (changed.length === 0 && !configChanged) {
      await pullOnce()
      const merged = useChatStore.getState().settings
      const snap: Record<string, number> = {}
      for (const s of merged.sessions) if (!isBlankSession(s)) snap[s.id] = s.updatedAt
      pushedSnapshot = snap
      pushedConfigAt = merged.configUpdatedAt || 0
      return
    }
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessions: changed,
        tombstones: settings.tombstones,
        config: extractConfig(settings),
        configUpdatedAt: configAt,
      }),
    })
    if (!res.ok) return
    const data = await res.json()
    applyingRemote = true
    if (Array.isArray(data.sessions)) {
      useChatStore.getState().mergeRemote(data.sessions, data.tombstones || {})
    }
    if (data.config && typeof data.configUpdatedAt === 'number') {
      useChatStore.getState().mergeRemoteConfig(data.config, data.configUpdatedAt)
    }
    applyingRemote = false
    // record what's now synced so the next push only carries fresh changes
    const after = useChatStore.getState().settings
    const snap: Record<string, number> = {}
    for (const s of after.sessions) if (!isBlankSession(s)) snap[s.id] = s.updatedAt
    pushedSnapshot = snap
    pushedConfigAt = after.configUpdatedAt || 0
  } catch {
    // offline is fine — local-first
  }
}

async function pullOnce() {
  try {
    const res = await fetch('/api/sync', { method: 'GET' })
    if (!res.ok) return
    const data = await res.json()
    applyingRemote = true
    if (Array.isArray(data.sessions)) {
      useChatStore.getState().mergeRemote(data.sessions, data.tombstones || {})
    }
    if (data.config && typeof data.configUpdatedAt === 'number') {
      useChatStore.getState().mergeRemoteConfig(data.config, data.configUpdatedAt)
    }
    applyingRemote = false
  } catch {
    // offline is fine — local-first
  }
}

export function ChatSync() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    // recover server copy first (covers localStorage eviction), then reconcile
    pullOnce().then(doSync)
    const iv = setInterval(doSync, 45000)
    const unsub = useChatStore.subscribe((state, prev) => {
      if (applyingRemote) return
      if (state.settings.sessions !== prev.settings.sessions || state.settings.configUpdatedAt !== prev.settings.configUpdatedAt) {
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(doSync, 2500)
      }
    })
    return () => {
      clearInterval(iv)
      unsub()
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  return null
}
