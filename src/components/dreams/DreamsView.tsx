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
  trigger?: 'interval' | 'alarm'
  startedAt?: number
  finishedAt?: number
  sessionWrite?: 'appended' | 'duplicate' | 'skipped' | 'failed'
  error?: string
}

interface WakeConfig {
  enabled: boolean
  sessionId: string | null
  lastWakeAt: number
  lastActivityAt: number
  customPrompt?: string
  pushEnabled?: boolean
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
  const [nextWake, setNextWake] = useState<{ at: number; isAlarm: boolean; note?: string } | null>(null)
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

  const toggleEnabled = async () => {
    if (!config) return
    const next = !config.enabled
    await fetch('/api/wake', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: next }),
    })
    setConfig({ ...config, enabled: next })
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
      const info = await fetch('/api/push', { cache: 'no-store' }).then((r) => r.json())
      let subscription = await registration.pushManager.getSubscription()
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(info.publicKey) })
      await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'subscribe', subscription: subscription.toJSON() }) })
      await fetch('/api/wake', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pushEnabled: true }) })
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
      setPushStatus(d.sent ? `已发送 ${d.sent} 条` : '没有可用的订阅设备')
    } catch { setPushStatus('测试发送失败') }
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
            {/* Wake config panel */}
            <div className={`rounded-2xl p-4 space-y-3 ${n ? 'bg-night-card' : 'bg-white shadow-sm'}`}>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium">💓 心跳唤醒</h3>
                  <p className={`text-[10px] mt-0.5 ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                    {config?.enabled
                      ? '星星会自己醒来，做她想做的事'
                      : '唤醒已关闭'}
                  </p>
                </div>
                <button
                  onClick={toggleEnabled}
                  className={`relative w-12 h-7 rounded-full transition flex-shrink-0 ${
                    config?.enabled
                      ? n ? 'bg-night-amber' : 'bg-day-pink'
                      : n ? 'bg-night-surface' : 'bg-gray-200'
                  }`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                    config?.enabled ? 'translate-x-5' : ''
                  }`} />
                </button>
              </div>

              {/* Session selector */}
              <div className="space-y-1.5">
                <label className={`text-[11px] ${n ? 'text-night-muted' : 'text-day-muted'}`}>主对话框</label>
                <select
                  value={config?.sessionId || ''}
                  onChange={(e) => setSession(e.target.value)}
                  className={`w-full text-sm px-3 py-2 rounded-xl outline-none ${
                    n ? 'bg-night-surface border-night-border text-night-text' : 'bg-gray-50 text-day-text'
                  }`}
                >
                  <option value="">未选择</option>
                  {sessions.map(s => (
                    <option key={s.id} value={s.id}>{s.title} ({s.messages.length}条)</option>
                  ))}
                </select>
              </div>

              {/* Status */}
              {config && (
                <div className={`text-[10px] space-y-0.5 ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                  {config.enabled && nextWake && (
                    <p className={n ? 'text-night-amber' : 'text-day-pink'}>
                      预计下一次唤醒：{fmtTime(nextWake.at)}
                      {nextWake.isAlarm ? ` · ⏰闹钟${nextWake.note ? '「' + nextWake.note + '」' : ''}` : ''}
                    </p>
                  )}
                  {config.lastWakeAt > 0 && <p>上次醒来：{fmtRelative(config.lastWakeAt)}</p>}
                  {config.lastActivityAt > 0 && <p>上次活动：{fmtRelative(config.lastActivityAt)}</p>}
                  <p>规则：白天(9-24点)每小时 · 深夜(0-9点)每3小时 · 所有唤醒（含闹钟）都等待对话安静30分钟</p>
                </div>
              )}
            </div>

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
                      <span className="text-base">{log.silent ? '🌙' : '💬'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">
                          {log.silent ? '静默醒来' : log.response.slice(0, 60)}
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
                              <span>类型：{log.trigger === 'alarm' ? '闹钟' : '定时'}</span>
                              <span>写入：{log.sessionWrite || '旧记录'}</span>
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
