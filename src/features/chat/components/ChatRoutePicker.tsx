'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown } from 'lucide-react'
import type { ApiProfile, ProviderModel } from '@/features/chat/state/types'
import type { ChatRoute } from '@/lib/chat-route'
import type { CcStatus } from '@/features/chat/api/client'
import { CC_MODELS, type CcModelId } from '@/lib/cc-model'

type ModelChoice = { profile: ApiProfile; model: ProviderModel }

export function ChatRouteChip({
  route,
  isNight,
  onClick,
}: {
  route: ChatRoute
  isNight: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label="选择发送线路与模型"
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-[10px] transition ${isNight ? 'border-night-border/80 bg-night-surface/75 text-night-muted hover:border-night-muted/45' : 'border-[#a73a32]/15 bg-white/35 text-[#a73a32]/60 hover:border-[#a73a32]/30'}`}
    >
      <span className={`font-semibold tracking-[0.12em] ${isNight ? 'text-night-muted' : 'text-[#a73a32]/65'}`}>{route === 'claude-code' ? 'CC' : 'API'}</span>
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
  activeCcModel,
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
  activeCcModel: CcModelId
  ccStatus: CcStatus
  onSelectApiModel: (profileId: string, modelId: string) => void
  onSelectCc: (model: CcModelId) => void
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
            className={`fixed bottom-0 left-0 right-0 z-[61] max-h-[65dvh] rounded-t-2xl shadow-2xl flex flex-col ${isNight ? 'bg-night-card text-night-text' : 'chat-paper text-[#3f2c29]'}`}
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
          >
            <div className="flex justify-center pt-2 pb-1"><div className={`w-10 h-1 rounded-full ${isNight ? 'bg-night-border' : 'bg-[#a73a32]/20'}`} /></div>
            <div className="px-4 pb-3">
              <div className="text-xs font-medium">发送线路与模型</div>
              <div className="mt-1 flex items-center gap-1.5 text-[10px] opacity-50">
                <span className={`h-1.5 w-1.5 rounded-full ${isNight ? 'bg-night-muted' : 'bg-[#DBB9B3]'}`} />
                API 已连接 · CC {ccStatus.available ? '已连接' : ccStatus.configured ? '暂时离线' : '尚未配置'}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1">
              <div className="mb-3 space-y-1">
                {CC_MODELS.map(model => {
                  const active = activeRoute === 'claude-code' && activeCcModel === model.id
                  return (
                    <button
                      key={model.id}
                      type="button"
                      disabled={!ccStatus.available}
                      onClick={() => onSelectCc(model.id)}
                      className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${active ? (isNight ? 'border-night-muted/40 bg-night-muted/15' : 'border-[#DBB9B3]/55 bg-[#DBB9B3]/30') : (isNight ? 'border-night-border hover:bg-night-surface' : 'border-[#a73a32]/15 hover:bg-[#fffaf5]/70')} ${ccStatus.available ? '' : 'cursor-not-allowed opacity-45'}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium">Claude Code · {model.name}</div>
                          {(!ccStatus.available || !ccStatus.toolsAvailable) && <div className="mt-0.5 text-[10px] opacity-50">{ccStatus.available
                            ? '文字聊天已接通 · 生活工具尚未接通'
                            : ccStatus.configured ? '网关暂时无法连接' : '服务端尚未配置 CC 网关'}</div>}
                        </div>
                        {active && <Check size={16} className={`flex-shrink-0 ${isNight ? 'text-night-muted' : 'text-[#DBB9B3]'}`} />}
                      </div>
                    </button>
                  )
                })}
              </div>
              {filtered.map(({ profile, model }) => {
                const active = activeRoute === 'api' && activeProfileId === profile.id && activeModelId === model.id
                return (
                  <button key={`${profile.id}-${model.id}`}
                    onClick={() => onSelectApiModel(profile.id, model.id)}
                    className={`w-full text-left px-3 py-2.5 rounded-xl ${active ? (isNight ? 'bg-night-muted/15' : 'bg-[#DBB9B3]/45') : (isNight ? 'hover:bg-night-surface' : 'hover:bg-[#fffaf5]/70')}`}>
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{profile.name} · {model.name || model.id}</div>
                        <div className="text-[10px] opacity-40 truncate">API · {model.id}</div>
                      </div>
                      {active && <Check size={16} className={`flex-shrink-0 ml-2 ${isNight ? 'text-night-muted' : 'text-[#DBB9B3]'}`} />}
                    </div>
                  </button>
                )
              })}
              {!filtered.length && <div className="text-center text-xs opacity-40 py-8">没有可用的 API 模型</div>}
            </div>
            <div className={`flex gap-1 px-4 py-3 border-t overflow-x-auto pb-[max(0.75rem,env(safe-area-inset-bottom))] ${isNight ? 'border-night-border' : 'border-[#a73a32]/15'}`}>
              <button onClick={() => setProviderFilter(null)}
                className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${!providerFilter ? (isNight ? 'bg-night-muted/20 text-night-muted' : 'bg-[#DBB9B3]/40 text-[#8a625d] font-medium') : 'opacity-60'}`}>全部 API</button>
              {providerNames.map(name => (
                <button key={name} onClick={() => setProviderFilter(providerFilter === name ? null : name)}
                  className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${providerFilter === name ? (isNight ? 'bg-night-muted/20 text-night-muted' : 'bg-[#DBB9B3]/40 text-[#8a625d] font-medium') : 'opacity-60'}`}>{name}</button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
