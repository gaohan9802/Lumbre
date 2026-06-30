'use client'

import { useEffect } from 'react'
import { useChatStore } from '@/lib/chatStore'

/**
 * Invisible component that handles cross-device sync.
 * - Pulls from server on mount
 * - Pulls on window focus (switching back from another app)
 * - Pushes unsynced messages periodically
 */
export function ChatSync() {
  const { pullFromServer, pushToServer, messages } = useChatStore()

  // Pull on mount
  useEffect(() => {
    pullFromServer()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Pull on tab/app focus
  useEffect(() => {
    const handleFocus = () => {
      pullFromServer()
    }
    window.addEventListener('focus', handleFocus)
    // Also handle iOS returning from background
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pullFromServer()
    })
    return () => {
      window.removeEventListener('focus', handleFocus)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Push unsynced on interval (backup, in case fire-and-forget failed)
  useEffect(() => {
    const hasUnsynced = messages.some((m) => !m.synced)
    if (!hasUnsynced) return

    const timer = setTimeout(() => pushToServer(), 5000)
    return () => clearTimeout(timer)
  }, [messages]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}
