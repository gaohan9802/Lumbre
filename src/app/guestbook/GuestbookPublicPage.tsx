'use client'

import { FormEvent, useEffect, useState } from 'react'
import { Pin } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { useTheme } from '@/lib/theme'
import { GuestbookBoard } from '@/components/notes/GuestbookBoard'

interface SessionState {
  configured: boolean
  claimed: boolean
  authorized: boolean
  guest_name?: string
}

export function GuestbookPublicPage() {
  const { theme } = useTheme()
  const night = theme === 'night'
  const [session, setSession] = useState<SessionState | null>(null)
  const [password, setPassword] = useState('')
  const [nickname, setNickname] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiRequest('/api/guestbook/public/session').then(setSession).catch((reason: any) => setError(reason?.message || '告状簿暂时打不开'))
  }, [])

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await apiRequest('/api/guestbook/public/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, nickname }),
      })
      setSession(current => ({ configured: true, claimed: true, authorized: true, guest_name: result.guest_name || current?.guest_name }))
    } catch (reason: any) {
      setError(reason?.message || '进门失败')
    } finally {
      setBusy(false)
    }
  }

  if (session?.authorized) {
    return (
      <main className={`h-dvh overflow-hidden ${night ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
        <div className={`mx-auto flex h-full max-w-3xl flex-col sm:my-5 sm:h-[calc(100dvh-2.5rem)] sm:overflow-hidden sm:rounded-[28px] sm:border sm:shadow-xl ${night ? 'border-night-border bg-night-bg' : 'border-[#ead5ce] bg-[#fffaf6]'}`}>
          <header className={`flex items-center justify-between border-b px-5 py-4 ${night ? 'border-night-border' : 'border-[#ead5ce]'}`}>
            <h1 className="flex items-center gap-2 text-xl font-medium"><Pin size={17}/> 告状簿</h1>
            <span className="text-xs opacity-45">🌙 {session.guest_name}</span>
          </header>
          <div className="min-h-0 flex-1"><GuestbookBoard actor="guest" endpoint="/api/guestbook/public/messages" /></div>
        </div>
      </main>
    )
  }

  return (
    <main className={`relative flex min-h-dvh items-center justify-center overflow-hidden px-5 py-10 ${night ? 'bg-night-bg text-night-text' : 'bg-day-bg text-day-text'}`}>
      <form onSubmit={login} className={`w-full max-w-sm rounded-[28px] border p-6 shadow-xl ${night ? 'border-night-border bg-night-surface' : 'border-[#ead5ce] bg-white/80'}`}>
        <div className="mb-6 text-center">
          <Pin className="mx-auto mb-3 opacity-60" size={22}/>
          <h1 className="text-2xl font-medium">告状簿</h1>
          <p className="mt-2 text-xs opacity-50">小火、星星和你的小纸条</p>
        </div>
        {!session?.configured && session && <p className="mb-4 text-sm text-red-500">告状簿尚未配置访问口令。</p>}
        {session && !session.claimed && (
          <label className="mb-4 block text-xs opacity-70">
            第一次来，给自己取个昵称
            <input value={nickname} onChange={event => setNickname(event.target.value)} maxLength={24} required className="mt-2 w-full rounded-xl border border-current/20 bg-transparent px-3 py-2.5 text-sm outline-none" />
          </label>
        )}
        <label className="block text-xs opacity-70">
          访问口令
          <input type="password" value={password} onChange={event => setPassword(event.target.value)} required className="mt-2 w-full rounded-xl border border-current/20 bg-transparent px-3 py-2.5 text-sm outline-none" />
        </label>
        {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
        <button disabled={busy || !session?.configured} className={`mt-5 w-full rounded-xl py-2.5 text-sm font-medium disabled:opacity-35 ${night ? 'bg-night-amber text-night-bg' : 'chat-dialog-accent'}`}>
          {busy ? '开门中…' : '打开告状簿'}
        </button>
      </form>
    </main>
  )
}
