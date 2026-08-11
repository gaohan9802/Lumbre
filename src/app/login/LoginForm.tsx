'use client'

import { FormEvent, useState } from 'react'
import { LockKeyhole } from 'lucide-react'

export function LoginForm({ next, notConfigured }: { next: string; notConfigured: boolean }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState(notConfigured ? '服务器尚未设置访问密码，请先在 Zeabur 配置 LUMBRE_ACCESS_PASSWORD（至少 12 位）。' : '')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!password || loading) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, next }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || '登录失败，请稍后再试。')
      window.location.replace(data.next || '/')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '登录失败，请稍后再试。')
      setPassword('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm rounded-[28px] border border-day-border/70 bg-white/80 p-6 shadow-xl backdrop-blur-xl dark:border-night-border dark:bg-night-card/90 sm:p-8">
      <div className="mb-7 flex flex-col items-center text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-day-pink/15 text-day-pink dark:bg-night-amber/15 dark:text-night-amber">
          <LockKeyhole size={25} />
        </div>
        <h1 className="font-serif text-2xl font-semibold tracking-wide">回到 Lumbre</h1>
        <p className="mt-2 text-sm text-day-muted dark:text-night-muted">这里是星星和小火的私人空间</p>
      </div>

      <label htmlFor="password" className="mb-2 block text-xs font-medium tracking-wider text-day-muted dark:text-night-muted">访问密码</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        autoFocus
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        className="w-full rounded-2xl border border-day-border bg-white/80 px-4 py-3.5 text-base outline-none transition focus:border-day-pink dark:border-night-border dark:bg-night-surface dark:focus:border-night-amber"
        placeholder="请输入密码"
      />

      {error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-night-error/10 dark:text-night-error">{error}</p>}

      <button
        type="submit"
        disabled={!password || loading || notConfigured}
        className="mt-5 w-full rounded-2xl bg-day-pink px-4 py-3.5 text-sm font-semibold text-white transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-night-amber dark:text-night-bg"
      >
        {loading ? '正在验证…' : '进入我们的家'}
      </button>
      <p className="mt-4 text-center text-[11px] text-day-muted/70 dark:text-night-muted/70">登录状态保留 30 天 · 密码不会存入浏览器</p>
    </form>
  )
}
