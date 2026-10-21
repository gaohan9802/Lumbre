'use client'

import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useChatStore, getEnabledModels } from '@/lib/chatStore'
import { useTheme } from '@/lib/theme'
import { chatApi, type CcStatus } from '@/features/chat/api/client'
import type { ChatSession } from '@/features/chat/state/types'
import { normalizeChatRoute, type ChatRoute } from '@/lib/chat-route'
import {
  CC_EFFORTS, CC_MODELS, ccEffortsForModel, isCcEffort, isCcModel,
  normalizeCcEffortForModel, type CcEffort, type CcModelId,
} from '@/lib/cc-model'
import { ccSystemPromptForModel } from '@/lib/cc-system-prompt'
import { ccContextLevel } from '@/lib/chat-window-config'
import { APP_TIME_ZONE } from '@/lib/madrid-time'

const fmtTokens = (value?: number | null) => value == null ? '—' : value >= 1_000_000
  ? `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`
  : value >= 1_000 ? `${Math.round(value / 1_000)}K` : String(value)

export function ChatWindowSettings({
  open,
  session,
  ccStatus,
  chatBusy,
  onClose,
  onRefreshCc,
  onCompacted,
  onDefaultPrompt,
  onSummary,
}: {
  open: boolean
  session?: ChatSession
  ccStatus: CcStatus
  chatBusy: boolean
  onClose: () => void
  onRefreshCc: () => Promise<unknown>
  onCompacted: () => void
  onDefaultPrompt: () => void
  onSummary: () => void
}) {
  const { theme } = useTheme()
  const night = theme === 'night'
  const { settings, setGenerationRoute, setCcModel, setWindowConfig, setCcContextState } = useChatStore()
  const choices = useMemo(() => getEnabledModels(settings), [settings])
  const [route, setRoute] = useState<ChatRoute>('api')
  const [apiChoice, setApiChoice] = useState('')
  const [ccModel, setLocalCcModel] = useState<CcModelId>('claude-opus-4-6')
  const [ccEffort, setLocalCcEffort] = useState<CcEffort>('high')
  const [independentPrompt, setIndependentPrompt] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [compactState, setCompactState] = useState<'idle' | 'running'>('idle')
  const [compactMessage, setCompactMessage] = useState('')

  useEffect(() => {
    if (!open || !session) return
    const config = session.windowConfig
    const fallbackProfile = settings.apiProfiles.find(item => item.id === settings.activeProfileId) || settings.apiProfiles[0]
    const profile = settings.apiProfiles.find(item => item.id === config?.apiProfileId) || fallbackProfile
    const model = profile?.models.some(item => item.id === config?.apiModelId)
      ? config?.apiModelId
      : profile?.id === settings.activeProfileId ? settings.model : profile?.defaultModel
    const selectedCcModel = isCcModel(session.ccModel) ? session.ccModel : 'claude-opus-4-6'
    const selectedEffort = normalizeCcEffortForModel(selectedCcModel, config?.ccEffort || settings.ccEffort) || ccEffortsForModel(selectedCcModel)[0] || 'high'
    setRoute(normalizeChatRoute(session.generationRoute))
    setApiChoice(profile && model ? `${profile.id}\n${model}` : '')
    setLocalCcModel(selectedCcModel)
    setLocalCcEffort(selectedEffort)
    setIndependentPrompt(!!config?.systemPrompt)
    setPrompt(config?.systemPrompt || ccSystemPromptForModel(settings.systemPrompt, settings.ccOpus55SystemPrompt, selectedCcModel))
    setError('')
    setCompactMessage('')
  }, [open, session?.id, session?.windowConfigUpdatedAt, session?.generationRouteUpdatedAt, session?.ccModelUpdatedAt, settings])

  if (!open || !session) return null
  const card = night ? 'border-night-border bg-night-card/70' : 'border-[#a73a32]/15 bg-[#fffaf5]/55'
  const control = night ? 'border-night-border bg-night-card text-night-text' : 'border-[#a73a32]/15 bg-[#fffaf5] text-[#3f2c29]'
  const availableEfforts = ccEffortsForModel(ccModel)
  const contextLevel = ccContextLevel(ccStatus.context.usedPercentage)
  const contextNotice = contextLevel === 95 ? '接近上限 · 建议现在压缩'
    : contextLevel === 85 ? '建议近期压缩'
      : contextLevel === 70 ? '已进入上下文后半程' : ''
  const save = () => {
    if (independentPrompt && (!prompt.trim() || new TextEncoder().encode(prompt).length > 64_000)) {
      setError('本窗 SP 不能为空，且不能超过 64 KB。')
      return
    }
    const [apiProfileId, apiModelId] = apiChoice.split('\n')
    if (route === 'api' && (!apiProfileId || !apiModelId)) {
      setError('请先选择一个 API 模型。')
      return
    }
    setGenerationRoute(session.id, route)
    setCcModel(session.id, ccModel)
    setWindowConfig(session.id, {
      systemPrompt: independentPrompt ? prompt : undefined,
      apiProfileId: apiProfileId || session.windowConfig?.apiProfileId,
      apiModelId: apiModelId || session.windowConfig?.apiModelId,
      ccEffort: isCcEffort(ccEffort) ? ccEffort : undefined,
    })
    onClose()
  }
  const compact = async () => {
    if (!window.confirm('压缩当前 CC 上下文？\n\n不会删除 Lumbre 聊天、摘要或记忆；失败时会恢复压缩前的 CC transcript。')) return
    setCompactState('running'); setCompactMessage('')
    try {
      const result = await chatApi.compactCc({ session_id: session.id })
      const before = result.before?.usedTokens
      const after = result.after?.usedTokens
      setCcContextState(session.id, current => ({
        ...current,
        warningLevel: undefined,
        lastCompaction: { at: Date.now(), source: 'manual', beforeTokens: before, afterTokens: after },
      }))
      onCompacted()
      setCompactMessage(before != null && after != null ? `已压缩 · ${fmtTokens(before)} → ${fmtTokens(after)}` : '已完成压缩')
      await onRefreshCc()
    } catch (cause: any) {
      setCompactMessage(cause?.message || '压缩失败，原会话已保留。')
    } finally { setCompactState('idle') }
  }

  return <>
    <button type="button" aria-label="关闭本窗设置" onClick={onClose} className="fixed inset-0 z-[72] bg-black/30 backdrop-blur-sm" />
    <section role="dialog" aria-modal="true" aria-labelledby="window-settings-title" className={`fixed inset-x-3 bottom-3 top-[max(.75rem,env(safe-area-inset-top))] z-[73] mx-auto flex max-w-xl flex-col overflow-hidden rounded-[28px] ${night ? 'border border-night-border bg-night-surface text-night-text shadow-2xl' : 'chat-dialog'}`}>
      <header className="flex items-start justify-between gap-3 border-b border-current/10 px-5 py-4">
        <div className="min-w-0"><h2 id="window-settings-title" className="font-medium">本窗设置</h2><p className="mt-0.5 truncate text-[10px] opacity-40">{session.title}</p></div>
        <button type="button" aria-label="关闭" onClick={onClose} className="rounded-full p-1.5 opacity-55"><X size={17}/></button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <section className="space-y-2">
          <h3 className="px-1 text-[10px] tracking-[.18em] opacity-40">线路与模型</h3>
          <div className={`space-y-3 rounded-2xl border p-4 ${card}`}>
            <label className="block text-xs">当前线路<select value={route} onChange={event => setRoute(event.target.value as ChatRoute)} className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-xs outline-none ${control}`}><option value="api">API</option><option value="claude-code">Claude Code</option></select></label>
            {route === 'api' ? <label className="block text-xs">模型<select value={apiChoice} onChange={event => setApiChoice(event.target.value)} className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-xs outline-none ${control}`}>{choices.map(({ profile, model }) => <option key={`${profile.id}:${model.id}`} value={`${profile.id}\n${model.id}`}>{profile.name} · {model.name || model.id}</option>)}</select></label> : <>
              <label className="block text-xs">模型<select value={ccModel} onChange={event => { const model = event.target.value as CcModelId; setLocalCcModel(model); setLocalCcEffort(normalizeCcEffortForModel(model, ccEffort) || ccEffortsForModel(model)[0] || 'high') }} className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-xs outline-none ${control}`}>{CC_MODELS.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</select></label>
              <label className="block text-xs">推理档位<select value={availableEfforts.length ? ccEffort : ''} disabled={!availableEfforts.length} onChange={event => setLocalCcEffort(event.target.value as CcEffort)} className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-xs outline-none disabled:opacity-45 ${control}`}>{!availableEfforts.length && <option value="">该模型自动</option>}{CC_EFFORTS.filter(item => availableEfforts.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            </>}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="px-1 text-[10px] tracking-[.18em] opacity-40">本窗 SP</h3>
          <div className={`space-y-3 rounded-2xl border p-4 ${card}`}>
            <button type="button" role="switch" aria-checked={independentPrompt} onClick={() => setIndependentPrompt(value => !value)} className="flex w-full items-center justify-between text-sm"><span>{independentPrompt ? '使用本窗独立 SP' : '跟随默认 SP'}</span><span className={`h-6 w-10 rounded-full p-0.5 ${independentPrompt ? (night ? 'bg-night-muted' : 'bg-[#DBB9B3]') : 'bg-gray-400/40'}`}><span className={`block h-5 w-5 rounded-full bg-white transition-transform ${independentPrompt ? 'translate-x-4' : ''}`}/></span></button>
            {independentPrompt && <textarea aria-label="本窗独立 SP" value={prompt} onChange={event => setPrompt(event.target.value)} className={`min-h-44 w-full rounded-xl border p-3 text-xs leading-6 outline-none ${control}`} />}
            <div className="flex items-center justify-between gap-3 text-[10px] opacity-50"><span>修改后，下次 CC 回复会重建本窗 session；聊天记录不会丢。</span><button type="button" onClick={onDefaultPrompt} className="shrink-0 underline underline-offset-2">编辑默认 SP</button></div>
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="px-1 text-[10px] tracking-[.18em] opacity-40">上下文</h3>
          <div className={`rounded-2xl border p-4 ${card}`}>
            <div className="flex items-end justify-between gap-3"><span className="text-xl tabular-nums">{fmtTokens(ccStatus.context.usedTokens)} / {fmtTokens(ccStatus.context.maxTokens)}</span><span className="text-[10px] opacity-45">{ccStatus.context.available ? `${ccStatus.context.usedPercentage ?? '—'}%` : '等待首条 CC 回复'}</span></div>
            <div className={`mt-2 h-1 overflow-hidden rounded-full ${night ? 'bg-night-surface' : 'bg-black/5'}`}><div className={`h-full rounded-full ${contextLevel === 95 ? 'bg-red-500' : contextLevel >= 85 ? 'bg-amber-500' : night ? 'bg-night-muted' : 'bg-[#DBB9B3]'}`} style={{ width: `${Math.min(100, ccStatus.context.usedPercentage || 0)}%` }}/></div>
            {contextNotice && <p className={`mt-2 text-[10px] ${contextLevel === 95 ? 'text-red-500' : contextLevel >= 85 ? 'text-amber-600' : 'opacity-50'}`}>{contextNotice}</p>}
            {session.ccContextState?.lastCompaction && <p className="mt-2 text-[10px] opacity-45">{session.ccContextState.lastCompaction.source === 'manual' ? '手动' : '自动'}压缩于 {new Date(session.ccContextState.lastCompaction.at).toLocaleString('zh-CN', { timeZone: APP_TIME_ZONE, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}{session.ccContextState.lastCompaction.beforeTokens != null && session.ccContextState.lastCompaction.afterTokens != null ? ` · ${fmtTokens(session.ccContextState.lastCompaction.beforeTokens)} → ${fmtTokens(session.ccContextState.lastCompaction.afterTokens)}` : ''}</p>}
            <div className="mt-4 grid grid-cols-2 gap-2"><button type="button" disabled={normalizeChatRoute(session.generationRoute) !== 'claude-code' || !ccStatus.context.available || chatBusy || compactState === 'running'} onClick={() => void compact()} className={`rounded-xl border px-3 py-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-35 ${control}`}>{compactState === 'running' ? '正在压缩…' : '压缩 CC 上下文'}</button><button type="button" onClick={onSummary} className={`rounded-xl border px-3 py-2.5 text-xs ${control}`}>聊天摘要</button></div>
            {compactMessage && <p role="status" className={`mt-3 text-[10px] ${compactMessage.startsWith('已') ? 'opacity-60' : 'text-red-500'}`}>{compactMessage}</p>}
          </div>
        </section>
        {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      </div>
      <footer className="flex justify-end gap-2 border-t border-current/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"><button type="button" onClick={onClose} className={`rounded-xl border px-4 py-2.5 text-xs ${control}`}>取消</button><button type="button" onClick={save} className={`rounded-xl px-5 py-2.5 text-xs font-medium ${night ? 'bg-night-muted/25 text-night-muted' : 'bg-[#DBB9B3]/45 text-[#765953]'}`}>保存本窗设置</button></footer>
    </section>
  </>
}
