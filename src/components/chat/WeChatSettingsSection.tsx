'use client'

import { useEffect, useState } from 'react'
import { chatApi, type WeChatStatus } from '@/features/chat/api/client'
import type { ChatSession } from '@/features/chat/state/types'

function qrImage(value: string) {
  if (/^(data:image\/|https:\/\/)/.test(value)) return value
  if (value.trim().startsWith('<svg')) return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(value)}`
  return `data:image/png;base64,${value}`
}

export function WeChatSettingsSection({ session, night, card, control }: {
  session: ChatSession
  night: boolean
  card: string
  control: string
}) {
  const [status, setStatus] = useState<WeChatStatus | null>(null)
  const [login, setLogin] = useState<{
    qrcodeId: string
    qrcodeUrl: string
    targetSessionId: string
    pollBaseUrl?: string
    verifyCode?: string
    needsVerify?: boolean
    message?: string
  } | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const refresh = async () => {
    try { setStatus(await chatApi.wechat.status()) } catch (cause: any) { setError(cause?.message || '读取微信状态失败') }
  }

  useEffect(() => { void refresh() }, [])

  useEffect(() => {
    if (!login || login.needsVerify) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const result = await chatApi.wechat.pollLogin(login.qrcodeId, login.targetSessionId, login.pollBaseUrl, login.verifyCode)
        if (cancelled) return
        if (result.status === 'confirmed') {
          setLogin(null)
          setStatus(result as WeChatStatus)
          setError('')
          return
        }
        if (result.status === 'expired' || result.status === 'verify_code_blocked' || result.status === 'binded_redirect') {
          setError(result.message || (result.status === 'expired'
            ? '二维码已过期，请重新生成'
            : result.status === 'binded_redirect'
              ? '微信提示这个机器人已经绑定过，但 Lumbre 本地没有凭据；请先解除旧绑定后再试'
              : '验证码尝试次数过多，请重新生成二维码'))
          setLogin(null)
          return
        }
        if (result.status === 'need_verifycode') {
          setLogin(current => current ? { ...current, pollBaseUrl: result.pollBaseUrl || current.pollBaseUrl, needsVerify: true, message: result.message } : current)
          return
        }
        if (result.pollBaseUrl && result.pollBaseUrl !== login.pollBaseUrl) {
          setLogin(current => current ? { ...current, pollBaseUrl: result.pollBaseUrl, message: result.message } : current)
          return
        }
        timer = setTimeout(() => void poll(), 2_000)
      } catch (cause: any) {
        if (!cancelled) {
          setError(cause?.message || '二维码状态读取失败，正在重试')
          timer = setTimeout(() => void poll(), 3_000)
        }
      }
    }
    timer = setTimeout(() => void poll(), 800)
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [login])

  const start = async () => {
    setBusy(true); setError('')
    try { setLogin(await chatApi.wechat.startLogin(session.id)); setVerifyCode('') }
    catch (cause: any) { setError(cause?.message || '生成微信二维码失败') }
    finally { setBusy(false) }
  }

  const bind = async () => {
    setBusy(true); setError('')
    try { setStatus(await chatApi.wechat.bindSession(session.id)) }
    catch (cause: any) { setError(cause?.message || '改绑微信窗口失败') }
    finally { setBusy(false) }
  }

  const disconnect = async () => {
    if (!window.confirm('断开微信私聊？已经同步进 Lumbre 的聊天不会删除。')) return
    setBusy(true); setError('')
    try { setStatus(await chatApi.wechat.disconnect()); setLogin(null) }
    catch (cause: any) { setError(cause?.message || '断开微信失败') }
    finally { setBusy(false) }
  }

  const boundHere = status?.targetSessionId === session.id
  return <section className="space-y-2">
    <h3 className="px-1 text-[10px] tracking-[.18em] opacity-40">微信私聊</h3>
    <div className={`space-y-3 rounded-2xl border p-4 ${card}`}>
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-sm">{status?.connected ? (boundHere ? '已接入本窗' : '已接入另一个窗口') : '尚未连接'}</p><p className="mt-1 text-[10px] leading-5 opacity-50">消息逐条保存；连续消息停 10 秒后，星星合并回复一次。微信只显示最终回复。</p></div>
        {status?.connected && <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${status.monitor.running ? (night ? 'bg-night-muted' : 'bg-[#DBB9B3]') : 'bg-amber-500'}`} />}
      </div>
      {login && <div className="rounded-xl border border-current/10 p-3 text-center"><img src={qrImage(login.qrcodeUrl)} alt="微信登录二维码" className="mx-auto h-44 w-44 rounded-lg bg-white p-2"/><p className="mt-2 text-[10px] opacity-55">请用微信扫一扫；确认后会自动接入本窗</p></div>}
      {login?.needsVerify && <div className="flex gap-2"><input value={verifyCode} onChange={event => setVerifyCode(event.target.value)} inputMode="numeric" placeholder="输入微信显示的验证码" className={`min-w-0 flex-1 rounded-xl border px-3 py-2.5 text-xs outline-none ${control}`}/><button type="button" disabled={!verifyCode.trim()} onClick={() => setLogin(current => current ? { ...current, needsVerify: false, verifyCode: verifyCode.trim() } : current)} className={`rounded-xl border px-3 py-2.5 text-xs disabled:opacity-40 ${control}`}>确认</button></div>}
      {status?.lastMessageAt && <p className="text-[10px] opacity-45">最近同步：{new Date(status.lastMessageAt).toLocaleString('zh-CN', { hour12: false })}</p>}
      {(error || status?.lastError || status?.monitor.lastError) && <p role="alert" className="text-[10px] text-red-500">{error || status?.lastError || status?.monitor.lastError}</p>}
      <div className="flex gap-2">
        {!status?.connected ? <button type="button" disabled={busy || !!login} onClick={() => void start()} className={`flex-1 rounded-xl border px-3 py-2.5 text-xs disabled:opacity-40 ${control}`}>{login ? '等待扫码…' : busy ? '正在生成…' : '扫码连接微信'}</button> : <>
          <button type="button" disabled={busy || boundHere} onClick={() => void bind()} className={`flex-1 rounded-xl border px-3 py-2.5 text-xs disabled:opacity-40 ${control}`}>{boundHere ? '当前绑定窗口' : '改绑到本窗'}</button>
          <button type="button" disabled={busy} onClick={() => void disconnect()} className={`rounded-xl border px-3 py-2.5 text-xs disabled:opacity-40 ${control}`}>断开</button>
        </>}
      </div>
    </div>
  </section>
}
