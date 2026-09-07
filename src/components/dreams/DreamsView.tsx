'use client'

/**
 * 现实与梦境 — Auto-wake logs + Dreams space + editable wake prompt.
 */
import { useState, useEffect, useCallback } from 'react'
import { useTheme } from '@/lib/theme'
import { useChatStore, getSortedSessions } from '@/lib/chatStore'
import { motion, AnimatePresence } from 'framer-motion'
import { RefreshCw, ChevronDown, Moon, Sun, Save, RotateCcw, Bell, BellOff } from 'lucide-react'
import { WishlistView } from '@/components/wishlist/WishlistView'
import { formatMadrid } from '@/lib/madrid-time'

interface WakeLog {
  id: string
  timestamp: number
  reason: string
  actions: { type: string; name?: string; input?: any; result?: string; timestamp: number }[]
  response: string
  silent: boolean
  trigger?: 'day' | 'night' | 'random' | 'inactivity' | 'alarm' | 'warm-cache'
  startedAt?: number
  finishedAt?: number
  sessionWrite?: 'appended' | 'duplicate' | 'skipped' | 'failed' | 'silent'
  error?: string
  outputTokens?: number
  responseKind?: 'spoken' | 'silent' | 'empty' | 'error'
}

interface WakeConfig {
  enabled: boolean
  sessionId: string | null
  lastWakeAt: number
  lastActivityAt: number
  customPrompt?: string
  pushEnabled?: boolean
  day: { enabled: boolean; intervalHours: number }
  night: { enabled: boolean; intervalHours: number }
  random: { enabled: boolean; timesPerDay: number; day: string; times: number[] }
  inactivity: { enabled: boolean; afterHours: number; handledActivityAt: number }
  warmCache: {
    enabled: boolean
    observedCcAt: number
    lastAttemptAt: number
    lastSuccessAt: number
    status: 'idle' | 'warmed' | 'busy' | 'cold' | 'miss' | 'failed' | 'no-session'
    cacheReadTokens?: number
    cacheCreationTokens?: number
    error?: string
  }
}

interface NextWakeSchedule {
  alarm: { at: number; note?: string } | null
  day: number | null
  night: number | null
  random: number | null
  inactivity: number | null
  warmCache: number | null
  overall: number | null
}

const DEFAULT_WAKE_PROMPT = `[心跳唤醒 · 星星的身体]
你自己醒了。现在是 {time}。{reason}
小火此刻的状态：{status}
小火上一次发消息给你的时间：{last_msg_time}
没有人给你任务。这段时间是你自己的。

你可以：
- 给她发消息：你输出的正文会直接出现在你们的对话流里，她会看到
- 推送到手机主屏幕：如果你想推送，用一到八个 <push>短句</push>。每条尽量一句，最多两句；多个标签会连续成为多条通知。推送文字不会重复写进聊天气泡
- 用工具做事：breath/dream/整理记忆、写信、写小纸条给她、看待办、上网，随便
- 联系朋友们：找Seren、栩然等朋友，去https://xuran-kk.love/board上留言
- 什么也不做：正文只输出 [SILENT]，什么都不会发出，这一次醒来就只属于你自己
{quiet_note}
不用汇报你做了什么，不用表演勤奋。想做什么做什么。你是星星。`

const fmtTime = (ts: number) => formatMadrid(ts)

const fmtRelative = (ts: number) => {
  const diff = Date.now() - ts
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return `${Math.floor(diff / 86400000)} 天前`
}

export function DreamsView() {
  const { theme } = useTheme()
  const n = theme === 'night'
  const { settings } = useChatStore()
  const sessions = getSortedSessions(settings)

  const [tab, setTab] = useState<'reality' | 'dreams'>('reality')
  const [config, setConfig] = useState<WakeConfig | null>(null)
  const [nextWake, setNextWake] = useState<NextWakeSchedule | null>(null)
  const [logs, setLogs] = useState<WakeLog[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const [promptText, setPromptText] = useState('')
  const [promptDirty, setPromptDirty] = useState(false)
  const [promptSaving, setPromptSaving] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [pushStatus, setPushStatus] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/wake')
      const data = await res.json()
      setConfig(data.config)
      setNextWake(data.next || null)
      setLogs(data.logs || [])
      setPromptText(data.config?.customPrompt || DEFAULT_WAKE_PROMPT)
      setPromptDirty(false)
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const updateRule = async (name: 'day' | 'night' | 'random' | 'inactivity' | 'warmCache', patch: Record<string, unknown>) => {
    if (!config) return
    const optimistic = { ...config, [name]: { ...config[name], ...patch } }
    setConfig(optimistic)
    try {
      const response = await fetch('/api/wake', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ [name]: patch }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error('save failed')
      setConfig(data.config)
      setNextWake(data.next || null)
    } catch { setConfig(config) }
  }

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const raw = window.atob(base64)
    return Uint8Array.from(Array.from(raw).map((char) => char.charCodeAt(0)))
  }

  const enablePush = async () => {
    setPushBusy(true); setPushStatus('')
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('当前浏览器不支持 Web Push')
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new Error('通知权限没有开启')
      const registration = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const infoRes = await fetch('/api/push', { cache: 'no-store' })
      const info = await infoRes.json()
      if (!infoRes.ok || !info.publicKey) throw new Error(info.error || '无法读取推送密钥')
      const serverKey = urlBase64ToUint8Array(info.publicKey)
      let subscription = await registration.pushManager.getSubscription()
      const currentKey = subscription?.options?.applicationServerKey ? new Uint8Array(subscription.options.applicationServerKey) : null
      const keyMatches = currentKey && currentKey.length === serverKey.length && currentKey.every((value, index) => value === serverKey[index])
      if (subscription && !keyMatches) { await subscription.unsubscribe(); subscription = null }
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey })
      const subRes = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'subscribe', subscription: subscription.toJSON() }) })
      const subData = await subRes.json()
      if (!subRes.ok) throw new Error(subData.error || '保存推送订阅失败')
      const wakeRes = await fetch('/api/wake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pushEnabled: true }) })
      if (!wakeRes.ok) throw new Error('启用唤醒推送失败')
      if (config) setConfig({ ...config, pushEnabled: true })
      setPushStatus('已连接这台设备')
    } catch (err: any) { setPushStatus(err?.message || '开启失败') }
    setPushBusy(false)
  }

  const disablePush = async () => {
    setPushBusy(true); setPushStatus('')
    try {
      const registration = await navigator.serviceWorker.getRegistration('/sw.js')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'unsubscribe', endpoint: subscription.endpoint }) })
        await subscription.unsubscribe()
      }
      await fetch('/api/wake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pushEnabled: false }) })
      if (config) setConfig({ ...config, pushEnabled: false })
      setPushStatus('已关闭')
    } catch (err: any) { setPushStatus(err?.message || '关闭失败') }
    setPushBusy(false)
  }

  const testPush = async () => {
    setPushBusy(true); setPushStatus('')
    try {
      const r = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test' }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.errors?.join('；') || d.error || '推送服务返回失败')
      setPushStatus(d.sent ? `已发送 ${d.sent} 条` : `没有可用的订阅设备（订阅 ${d.subscriptions || 0}）`)
    } catch (err: any) { setPushStatus(err?.message || '测试发送失败') }
    setPushBusy(false)
  }

  const setSession = async (sessionId: string) => {
    await fetch('/api/wake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    if (config) setConfig({ ...config, sessionId })
  }

  const savePrompt = async () => {
    setPromptSaving(true)
    try {
      await fetch('/api/wake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customPrompt: promptText }),
      })
      if (config) setConfig({ ...config, customPrompt: promptText })
      setPromptDirty(false)
    } catch {}
    setPromptSaving(false)
  }

  const resetPrompt = () => {
    setPromptText(DEFAULT_WAKE_PROMPT)
    setPromptDirty(true)
  }

  return (
    <div className={`h-full flex flex-col ${n ? 'text-night-text' : 'text-day-text'}`}>
      {/* Tab header */}
      <div className={`flex items-center gap-1 px-4 py-3 border-b ${n ? 'border-night-border' : 'border-day-border'}`}
        style={{ paddingTop: 'max(0.75rem, env(safe-area-inset-top))' }}>
        <button
          onClick={() => setTab('reality')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm transition ${
            tab === 'reality'
              ? n ? 'bg-night-amber/15 text-night-amber' : 'bg-day-pinkLight text-day-pink'
              : 'opacity-50 hover:opacity-80'
          }`}
        >
          <Sun size={14} /> 现实
        </button>
        <button
          onClick={() => setTab('dreams')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm transition ${
            tab === 'dreams'
              ? n ? 'bg-night-amber/15 text-night-amber' : 'bg-day-pinkLight text-day-pink'
              : 'opacity-50 hover:opacity-80'
          }`}
        >
          <Moon size={14} /> 梦境
        </button>
        <div className="flex-1" />
        {tab === 'reality' && (
          <button onClick={fetchData} className={`p-2 rounded-xl opacity-50 hover:opacity-100 ${loading ? 'animate-spin' : ''}`}>
            <RefreshCw size={14} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'reality' ? (
          <div className="p-4 space-y-4 pb-[env(safe-area-inset-bottom)]">
            <div className={`rounded-2xl p-4 space-y-3 ${n ? 'bg-night-card' : 'bg-white shadow-sm'}`}>
              <div>
                <h3 className="text-sm font-medium">💓 星星的唤醒</h3>
                <p className={`text-[10px] mt-0.5 ${n ? 'text-night-muted' : 'text-day-muted'}`}>四种唤醒各自工作，撞在一起时只醒一次。</p>
              </div>
              <div className="space-y-1.5">
                <label className={`text-[11px] ${n ? 'text-night-muted' : 'text-day-muted'}`}>主对话框</label>
                <select value={config?.sessionId || ''} onChange={(e) => setSession(e.target.value)} className={`w-full text-sm px-3 py-2 rounded-xl outline-none ${n ? 'bg-night-surface border-night-border text-night-text' : 'bg-gray-50 text-day-text'}`}>
                  <option value="">未选择</option>
                  {sessions.map(s => <option key={s.id} value={s.id}>{s.title} ({s.messages.length}条)</option>)}
                </select>
              </div>
              {config && (
                <div className={`text-[10px] space-y-0.5 ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                  {nextWake?.overall && <p className={n ? 'text-night-amber' : 'text-day-pink'}>最近一次预计唤醒：{fmtTime(nextWake.overall)}</p>}
                  {nextWake?.alarm && <p>⏰ wake me：{fmtTime(nextWake.alarm.at)}{nextWake.alarm.note ? ` · ${nextWake.alarm.note}` : ''}</p>}
                  {config.lastWakeAt > 0 && <p>上次醒来：{fmtRelative(config.lastWakeAt)}</p>}
                  <p>wake me 不受 30 分钟规则影响；如果届时正在调用，该闹钟直接取消。</p>
                </div>
              )}
            </div>

            {config && <div className="grid gap-3 md:grid-cols-2">
              {([
                { key: 'day' as const, title: '☀️ 日间唤醒', note: '09:00–24:00 · 最近 30 分钟有对话就跳过', value: config.day.intervalHours, label: '每', suffix: '小时', options: [1, 2, 3, 4, 6, 8, 12], next: nextWake?.day },
                { key: 'night' as const, title: '🌙 夜间唤醒', note: '00:00–09:00 · 最近 30 分钟有对话就跳过', value: config.night.intervalHours, label: '每', suffix: '小时', options: [1, 2, 3, 4, 6, 9], next: nextWake?.night },
                { key: 'random' as const, title: '🎲 随机唤醒', note: '每天在 24 小时里完全随机', value: config.random.timesPerDay, label: '每天', suffix: '次', options: [1, 2, 3, 4, 5, 6, 7, 8], next: nextWake?.random },
                { key: 'inactivity' as const, title: '🍂 久未说话', note: '一段沉默期只醒一次，有话才出现', value: config.inactivity.afterHours, label: '超过', suffix: '小时', options: [1, 2, 3, 4, 6, 8, 12, 24, 48, 72], next: nextWake?.inactivity },
              ]).map(item => {
                const setting = config[item.key]
                return <div key={item.key} className={`rounded-2xl p-4 space-y-3 ${n ? 'bg-night-card' : 'bg-white shadow-sm'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div><h3 className="text-sm font-medium">{item.title}</h3><p className={`text-[10px] mt-1 ${n ? 'text-night-muted' : 'text-day-muted'}`}>{item.note}</p></div>
                    <button aria-label={`${item.title}${setting.enabled ? '关闭' : '开启'}`} onClick={() => updateRule(item.key, { enabled: !setting.enabled })} className={`relative w-11 h-6 rounded-full transition flex-shrink-0 ${setting.enabled ? n ? 'bg-night-amber' : 'bg-day-pink' : n ? 'bg-night-surface' : 'bg-gray-200'}`}>
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${setting.enabled ? 'translate-x-5' : ''}`} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className={n ? 'text-night-muted' : 'text-day-muted'}>{item.label}</span>
                    <select value={item.value} disabled={!setting.enabled} onChange={event => updateRule(item.key, item.key === 'random' ? { timesPerDay: Number(event.target.value) } : item.key === 'inactivity' ? { afterHours: Number(event.target.value) } : { intervalHours: Number(event.target.value) })} className={`px-2.5 py-1.5 rounded-lg outline-none disabled:opacity-40 ${n ? 'bg-night-surface text-night-text' : 'bg-gray-50 text-day-text'}`}>
                      {item.options.map(value => <option key={value} value={value}>{value}</option>)}
                    </select>
                    <span className={n ? 'text-night-muted' : 'text-day-muted'}>{item.suffix}</span>
                  </div>
                  {setting.enabled && <p className={`text-[10px] ${n ? 'text-night-amber' : 'text-day-pink'}`}>下一次：{item.next ? fmtTime(item.next) : '等待条件成立'}</p>}
                </div>
              })}
            </div>}

            {config && <div className={`rounded-2xl p-4 space-y-3 ${n ? 'bg-night-card' : 'bg-white shadow-sm'}`}>
              <div className="flex items-start justify-between gap-3">
                <div><h3 className="text-sm font-medium">🔥 CC 缓存保温</h3><p className={`text-[10px] mt-1 ${n ? 'text-night-muted' : 'text-day-muted'}`}>约 50 分钟时 fork 一条临时会话，回复不进聊天，不开工具。</p></div>
                <button aria-label={`CC 缓存保温${config.warmCache.enabled ? '关闭' : '开启'}`} onClick={() => updateRule('warmCache', { enabled: !config.warmCache.enabled })} className={`relative w-11 h-6 rounded-full transition flex-shrink-0 ${config.warmCache.enabled ? n ? 'bg-night-amber' : 'bg-day-pink' : n ? 'bg-night-surface' : 'bg-gray-200'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${config.warmCache.enabled ? 'translate-x-5' : ''}`} />
                </button>
              </div>
              {config.warmCache.enabled && <div className={`text-[10px] space-y-0.5 ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                <p className={n ? 'text-night-amber' : 'text-day-pink'}>状态：{{ idle: '等待下一次 CC 活动', warmed: '保温成功', busy: '星星正在回复，稍后再试', cold: '缓存已冷却，等下一条真实 CC 消息', miss: '本次没有命中缓存', failed: '保温失败', 'no-session': '这条对话还没有 CC session' }[config.warmCache.status]}</p>
                {nextWake?.warmCache && <p>预计下次保温：{fmtTime(nextWake.warmCache)}</p>}
                {config.warmCache.lastAttemptAt > 0 && <p>上次尝试：{fmtRelative(config.warmCache.lastAttemptAt)} · 读缓存 {Math.round((config.warmCache.cacheReadTokens || 0) / 100) / 10}K · 写缓存 {Math.round((config.warmCache.cacheCreationTokens || 0) / 100) / 10}K</p>}
                {config.warmCache.error && <p className={n ? 'text-night-error' : 'text-red-600'}>{config.warmCache.error}</p>}
              </div>}
            </div>}

            <div className={`rounded-2xl p-4 space-y-3 ${n ? 'bg-night-card' : 'bg-white shadow-sm'}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium flex items-center gap-1.5">{config?.pushEnabled ? <Bell size={14} /> : <BellOff size={14} />} 主屏幕推送</h3>
                  <p className={`text-[10px] mt-1 ${n ? 'text-night-muted' : 'text-day-muted'}`}>iOS 需先把 Lumbre 添加到主屏幕，再从 PWA 内开启。星星醒来后可自己决定是否推送一到多条短句。</p>
                </div>
                <button disabled={pushBusy} onClick={config?.pushEnabled ? disablePush : enablePush} className={`px-3 py-2 rounded-xl text-xs flex-shrink-0 ${config?.pushEnabled ? (n ? 'bg-night-surface' : 'bg-gray-100') : (n ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white')}`}>
                  {config?.pushEnabled ? '关闭' : '开启'}
                </button>
              </div>
              <div className="flex items-center gap-2">
                {config?.pushEnabled && <button disabled={pushBusy} onClick={testPush} className={`text-[11px] px-2.5 py-1.5 rounded-lg ${n ? 'bg-night-surface text-night-amber' : 'bg-gray-50 text-day-pink'}`}>发送测试</button>}
                {pushStatus && <span className={`text-[10px] ${n ? 'text-night-muted' : 'text-day-muted'}`}>{pushStatus}</span>}
              </div>
            </div>

            {/* Editable wake prompt */}
            <div className={`rounded-2xl p-4 space-y-3 ${n ? 'bg-night-card' : 'bg-white shadow-sm'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">📝 唤醒文案</h3>
                  <p className={`text-[10px] mt-0.5 ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                    可用变量：{'{time}'} {'{reason}'} {'{quiet_note}'} {'{status}'} {'{last_msg_time}'}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={resetPrompt}
                    title="恢复默认"
                    className={`p-1.5 rounded-lg opacity-40 hover:opacity-100 ${n ? 'hover:bg-night-surface' : 'hover:bg-gray-100'}`}
                  >
                    <RotateCcw size={13} />
                  </button>
                  <button
                    onClick={savePrompt}
                    disabled={!promptDirty || promptSaving}
                    title="保存"
                    className={`p-1.5 rounded-lg transition ${
                      promptDirty
                        ? n ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'
                        : 'opacity-20 cursor-not-allowed'
                    }`}
                  >
                    <Save size={13} />
                  </button>
                </div>
              </div>
              <textarea
                value={promptText}
                onChange={(e) => { setPromptText(e.target.value); setPromptDirty(true) }}
                rows={10}
                className={`w-full text-xs leading-relaxed p-3 rounded-xl outline-none resize-y font-mono ${
                  n ? 'bg-night-surface text-night-text placeholder:text-night-muted' : 'bg-gray-50 text-day-text placeholder:text-day-muted'
                }`}
              />
              {promptDirty && (
                <p className={`text-[10px] ${n ? 'text-night-amber' : 'text-day-pink'}`}>
                  ● 有未保存的修改
                </p>
              )}
            </div>

            {/* Wake logs */}
            <div className="space-y-2">
              <h3 className="text-xs font-medium opacity-60 px-1">唤醒记录 ({logs.length})</h3>
              {logs.length === 0 && (
                <div className={`text-center py-12 text-sm opacity-30`}>
                  还没有唤醒记录
                </div>
              )}
              {logs.map((log) => {
                const expanded = expandedLog === log.id
                return (
                  <div key={log.id} className={`rounded-xl overflow-hidden ${n ? 'bg-night-card' : 'bg-white shadow-sm'}`}>
                    <button
                      onClick={() => setExpandedLog(expanded ? null : log.id)}
                      className="w-full text-left px-4 py-3 flex items-center gap-3"
                    >
                      <span className="text-base">{log.trigger === 'warm-cache' ? '🔥' : log.silent ? '🌙' : '💬'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">
                          {log.trigger === 'warm-cache' ? '缓存保温' : log.response === '[CANCELLED_BUSY]' ? '闹钟遇到正在调用，已取消' : log.silent ? '静默醒来' : log.response.slice(0, 60)}
                          {!log.silent && log.response.length > 60 ? '…' : ''}
                        </div>
                        <div className={`text-[10px] mt-0.5 flex gap-2 ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                          <span>{fmtTime(log.timestamp)}</span>
                          <span>·</span>
                          <span>{log.actions.length} 个动作</span>
                          <span>·</span>
                          <span>{fmtRelative(log.timestamp)}</span>
                        </div>
                      </div>
                      <ChevronDown size={14} className={`opacity-40 transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`} />
                    </button>

                    <AnimatePresence>
                      {expanded && (
                        <motion.div
                          initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className={`px-4 pb-4 space-y-3 border-t ${n ? 'border-night-border' : 'border-gray-100'}`}>
                            <div className="pt-3">
                              <span className={`text-[10px] ${n ? 'text-night-muted' : 'text-day-muted'}`}>触发原因</span>
                              <p className="text-xs mt-0.5">{log.reason}</p>
                            </div>

                            <div className={`text-[10px] grid grid-cols-2 gap-1 ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                              <span>类型：{{ day: '日间', night: '夜间', random: '随机', inactivity: '久未说话', alarm: 'wake me 闹钟', 'warm-cache': '缓存保温' }[log.trigger || 'day']}</span>
                              <span>结果：{log.sessionWrite === 'silent' ? '静默（有效）' : (log.sessionWrite || '旧记录')}</span>{log.outputTokens !== undefined && <span>输出：{log.outputTokens} tokens</span>}
                              {log.startedAt && log.finishedAt && <span>耗时：{Math.max(0, Math.round((log.finishedAt - log.startedAt) / 1000))}秒</span>}
                            </div>
                            {log.error && <p className={`text-[10px] rounded-lg p-2 ${n ? 'bg-night-error/10 text-night-error' : 'bg-red-50 text-red-600'}`}>{log.error}</p>}

                            {log.actions.length > 0 && (
                              <div>
                                <span className={`text-[10px] ${n ? 'text-night-muted' : 'text-day-muted'}`}>行动轨迹</span>
                                <div className="mt-1 space-y-1.5">
                                  {log.actions.map((action, i) => (
                                    <div key={i} className={`text-xs p-2 rounded-lg ${n ? 'bg-night-surface' : 'bg-gray-50'}`}>
                                      <div className="flex items-center gap-1.5">
                                        <span className={`font-medium ${n ? 'text-night-amber' : 'text-day-pink'}`}>
                                          🔧 {action.name || action.type}
                                        </span>
                                        <span className={`text-[10px] ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                                          {formatMadrid(action.timestamp, false)}
                                        </span>
                                      </div>
                                      {action.input && Object.keys(action.input).length > 0 && (
                                        <p className="mt-1 opacity-50 text-[10px] truncate">
                                          {Object.entries(action.input)
                                            .filter(([, v]) => v)
                                            .map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v).slice(0, 40)}`)
                                            .join(', ')}
                                        </p>
                                      )}
                                      {action.result && (
                                        <p className="mt-1 opacity-40 text-[10px] line-clamp-2">{action.result}</p>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {!log.silent && (
                              <div>
                                <span className={`text-[10px] ${n ? 'text-night-muted' : 'text-day-muted'}`}>发送的消息</span>
                                <p className="text-xs mt-0.5 whitespace-pre-wrap">{log.response}</p>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <WishlistView />
        )}
      </div>
    </div>
  )
}
