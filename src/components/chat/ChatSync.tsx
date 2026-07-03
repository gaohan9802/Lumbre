'use client'

/**
 * ChatSync — multi-device session sync.
 * Push+pull to /api/sync on mount, every 45s, and 2.5s after local changes.
 */
import { useEffect, useRef } from 'react'
import { useChatStore } from '@/lib/chatStore'

let applyingRemote = false

async function doSync() {
  try {
    const { settings } = useChatStore.getState()
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessions: settings.sessions, tombstones: settings.tombstones }),
    })
    if (!res.ok) return
    const data = await res.json()
    if (Array.isArray(data.sessions)) {
      applyingRemote = true
      useChatStore.getState().mergeRemote(data.sessions, data.tombstones || {})
      applyingRemote = false
    }
  } catch {
    // offline is fine — local-first
  }
}

export function ChatSync() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    doSync()
    const iv = setInterval(doSync, 45000)
    const unsub = useChatStore.subscribe((state, prev) => {
      if (applyingRemote) return
      if (state.settings.sessions !== prev.settings.sessions) {
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
