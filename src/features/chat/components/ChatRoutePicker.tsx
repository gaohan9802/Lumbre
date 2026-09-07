'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown } from 'lucide-react'
import type { ApiProfile, ProviderModel } from '@/features/chat/state/types'
import type { ChatRoute } from '@/lib/chat-route'
import type { CcStatus } from '@/features/chat/api/client'

type ModelChoice = { profile: ApiProfile; model: ProviderModel }

export function ChatRouteChip({
  profileName,
  modelName,
  route,
  ccStatus,
  isNight,
  onClick,
}: {
  profileName?: string
  modelName?: string
  route: ChatRoute
  ccStatus: CcStatus
  isNight: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label="选择发送线路与模型"
      onClick={onClick}
      className={`mb-2 ml-1 inline-flex max-w-[min(76vw,420px)] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] transition ${isNight ? 'border-night-border/80 bg-night-surface/75 text-night-muted hover:border-night-amber/45' : 'border-day-muted/15 bg-white/75 text-day-muted hover:border-day-pink/30'}`}
    >
      <span className={`font-semibold tracking-[0.12em] ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>{route === 'claude-code' ? 'CC' : 'API'}</span>
      <span className="opacity-35">·</span>
      <span className="truncate opacity-65">{route === 'claude-code'
        ? `Claude Code · ${ccStatus.model || '未连接'}`
        : `${profileName || 'API'} · ${modelName || '未选择模型'}`}</span>
      <ChevronDown size={11} className="flex-shrink-0 opacity-45" />
    </button>
  )
}

export function ChatRoutePicker({
  open,
  isNight,
  choices,
  activeProfileId,
  activeModelId,
  activeRoute,
  ccStatus,
  onSelectApiModel,
  onSelectCc,
  onClose,
}: {
  open: boolean
  isNight: boolean
  choices: ModelChoice[]
  activeProfileId: string
  activeModelId: string
  activeRoute: ChatRoute
  ccStatus: CcStatus
  onSelectApiModel: (profileId: string, modelId: string) => void
  onSelectCc: () => void
  onClose: () => void
}) {
  const [providerFilter, setProviderFilter] = useState<string | null>(null)
  const providerNames = Array.from(new Set(choices.map(({ profile }) => profile.name)))
  const filtered = providerFilter
    ? choices.filter(({ profile }) => profile.name === providerFilter)
    : choices

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[60] bg-black/20" />
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            className={`fixed bottom-0 left-0 right-0 z-[61] max-h-[65dvh] rounded-t-2xl shadow-2xl flex flex-col ${isNight ? 'bg-night-card text-night-text' : 'bg-[#faf9f5] text-day-text'}`}
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <div className="flex justify-center pt-2 pb-1"><div className={`w-10 h-1 rounded-full ${isNight ? 'bg-night-border' : 'bg-gray-300'}`} /></div>
            <div className="px-4 pb-3">
              <div className="text-xs font-medium">发送线路与模型</div>
              <div className="mt-1 flex items-center gap-1.5 text-[10px] opacity-50">
                <span className={`h-1.5 w-1.5 rounded-full ${isNight ? 'bg-night-amber' : 'bg-day-pink'}`} />
                API 已连接 · CC {ccStatus.available ? '已连接' : ccStatus.configured ? '暂时离线' : '尚未配置'}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1">
              <button
                type="button"
                disabled={!ccStatus.available}
                onClick={onSelectCc}
                className={`mb-3 w-full rounded-xl border px-3 py-3 text-left transition ${activeRoute === 'claude-code' ? (isNight ? 'border-night-amber/40 bg-night-amber/15' : 'border-day-pink/25 bg-day-lemon') : (isNight ? 'border-night-border hover:bg-night-surface' : 'border-gray-200 hover:bg-white')} ${ccStatus.available ? '' : 'cursor-not-allowed opacity-45'}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">Claude Code · {ccStatus.model || '订阅线路'}</div>
                    <div className="mt-0.5 text-[10px] opacity-50">{ccStatus.available
                      ? (ccStatus.toolsAvailable ? '文字聊天与生活工具已接通 · Bash/Shell 未开放' : '文字聊天已接通 · 生活工具尚未接通')
                      : ccStatus.configured ? '网关暂时无法连接' : '服务端尚未配置 CC 网关'}</div>
                  </div>
                  {activeRoute === 'claude-code' && <Check size={16} className={`flex-shrink-0 ${isNight ? 'text-night-amber' : 'text-day-pink'}`} />}
                </div>
              </button>
              {filtered.map(({ profile, model }) => {
                const active = activeRoute === 'api' && activeProfileId === profile.id && activeModelId === model.id
                return (
                  <button key={`${profile.id}-${model.id}`}
                    onClick={() => onSelectApiModel(profile.id, model.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl ${active ? (isNight ? 'bg-night-amber/15' : 'bg-day-lemon') : (isNight ? 'hover:bg-night-surface' : 'hover:bg-gray-50')}`}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{profile.name} · {model.name || model.id}</div>
                        <div className="text-[10px] opacity-40 truncate">API · {model.id}</div>
                      </div>
                      {active && <Check size={16} className={`flex-shrink-0 ml-2 ${isNight ? 'text-night-amber' : 'text-day-pink'}`} />}
                    </div>
                  </button>
                )
              })}
              {!filtered.length && <div className="text-center text-xs opacity-40 py-8">没有可用的 API 模型</div>}
            </div>
            <div className={`flex gap-1 px-4 py-3 border-t overflow-x-auto pb-[max(0.75rem,env(safe-area-inset-bottom))] ${isNight ? 'border-night-border' : 'border-gray-200'}`}>
              <button onClick={() => setProviderFilter(null)}
                className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${!providerFilter ? (isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-day-lemon text-day-text font-medium') : 'opacity-60'}`}>全部 API</button>
              {providerNames.map(name => (
                <button key={name} onClick={() => setProviderFilter(providerFilter === name ? null : name)}
                  className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${providerFilter === name ? (isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-day-lemon text-day-text font-medium') : 'opacity-60'}`}>{name}</button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
