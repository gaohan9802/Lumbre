'use client'
import { useEffect } from 'react'
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let registration: ServiceWorkerRegistration | null = null
    const update = () => {
      if (document.visibilityState === 'visible') void registration?.update().catch(() => {})
    }
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then((value) => { registration = value; update() })
      .catch(() => {})
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return null
}
