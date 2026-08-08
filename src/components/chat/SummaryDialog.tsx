'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { Archive, FileText, Loader2, Trash2, X } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { ChatSession, ChatSummary, useChatStore } from '@/lib/chatStore'
import { formatMadrid } from '@/lib/madrid-time'
import { newestPendingRounds, selectReverseSummarySegment } from '@/lib/chat-summary'

interface Props {
  open: boolean
  onClose: () => void
  session?: ChatSession
  generating?: boolean
  onGenerate: () => void
}

export function SummaryDialog({ open, onClose, session, generating, onGenerate }: Props) {
  const { theme } = useTheme()
  const n = theme === 'night'
  const { settings, deleteSummary, updateSessionSummaryConfig } = useChatStore()
  const config = session?.summaryConfig || { autoEnabled: true, turnSize: settings.summaryTurnSize, injectCount: settings.summaryInjectCount }
  const summaries = [...(session?.summaries || [])].sort((a, b) => b.endAt - a.endAt)
  const visibleSummaries = summaries.slice(0, 5)
  const archivedCount = Math.max(0, summaries.length - visibleSummaries.length)
  const pendingRounds = newestPendingRounds(session?.messages || [], session?.summaries || [])
  const autoRemaining = Math.max(0, config.turnSize - pendingRounds)
  const enough = !!selectReverseSummarySegment(session?.messages || [], session?.summaries || [], config.turnSize, false).length
  const selectedProfile = settings.apiProfiles.find(profile => profile.id === config.profileId) || settings.apiProfiles.find(profile => profile.id === settings.activeProfileId) || settings.apiProfiles[0]
  const selectedModel = config.modelId || (selectedProfile?.id === settings.activeProfileId ? settings.model : selectedProfile?.defaultModel) || selectedProfile?.models[0]?.id || ''
  const card = n ? 'bg-night-surface border-night-border' : 'bg-white border-gray-200'
  const patch = (value: any) => session && updateSessionSummaryConfig(session.id, value)

  return <AnimatePresence>{open && <>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[72] bg-black/40 backdrop-blur-sm" />
    <motion.div initial={{ opacity: 0, scale: .96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .96, y: 12 }}
      className={`fixed z-[73] inset-x-0 mx-auto w-[min(540px,calc(100vw-2rem))] max-h-[82dvh] overflow-y-auto rounded-2xl shadow-2xl ${n ? 'bg-night-card text-night-text' : 'bg-[#faf9f5] text-day-text'}`}
      style={{ top: 'max(calc(env(safe-area-inset-top, 0px) + 8dvh), 8dvh)' }}>
      <div className="sticky top-0 z-10 px-5 py-4 flex items-center justify-between backdrop-blur-md bg-inherit border-b border-current/10">
        <div><h3 className="text-lg font-medium flex items-center gap-2"><FileText size={18}/> 摘要</h3><p className="text-[10px] opacity-50 mt-0.5">当前对话独立设置 · 从最新对话向前倒序整理</p></div>
        <button onClick={onClose} className="p-2 opacity-60 hover:opacity-100"><X size={20}/></button>
      </div>
      <div className="p-5 space-y-5">
        <div className={`rounded-2xl border p-4 space-y-4 ${card}`}>
          <div className="flex items-center justify-between gap-4">
            <div><div className="text-xs font-medium">自动整理</div><div className="text-[10px] opacity-45 mt-1">只对这个对话生效</div></div>
            <button type="button" onClick={() => patch({ autoEnabled: !config.autoEnabled })}
              className={`relative w-11 h-6 rounded-full transition-colors ${config.autoEnabled ? (n ? 'bg-night-amber' : 'bg-day-pink') : 'bg-current/15'}`}>
              <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${config.autoEnabled ? 'translate-x-6' : 'translate-x-1'}`}/>
            </button>
          </div>
          <div>
            <div className="text-xs font-medium mb-2">每张摘要整理多少轮</div>
            <div className="grid grid-cols-3 gap-2">{([20,30,40] as const).map(v => <button key={v} onClick={() => patch({ turnSize: v })}
              className={`py-2 rounded-xl text-xs border ${config.turnSize === v ? (n ? 'border-night-amber bg-night-amber/15 text-night-amber' : 'border-day-pink bg-day-pinkLight text-day-pink') : 'border-current/10 opacity-60'}`}>{v}轮</button>)}</div>
          </div>
          <div>
            <div className="text-xs font-medium mb-2">带入对话的摘要</div>
            <div className="grid grid-cols-3 gap-2">{([3,4,5] as const).map(v => <button key={v} onClick={() => patch({ injectCount: v })}
              className={`py-2 rounded-xl text-xs border ${config.injectCount === v ? (n ? 'border-night-amber bg-night-amber/15 text-night-amber' : 'border-day-pink bg-day-pinkLight text-day-pink') : 'border-current/10 opacity-60'}`}>+{v}张</button>)}</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="text-[10px] opacity-60">摘要 API
              <select value={selectedProfile?.id || ''} onChange={e => {
                const profile = settings.apiProfiles.find(item => item.id === e.target.value)
                patch({ profileId: profile?.id, modelId: profile?.defaultModel || profile?.models[0]?.id })
              }} className={`mt-1 w-full rounded-xl border px-3 py-2 text-xs bg-transparent ${n ? 'border-night-border' : 'border-gray-200'}`}>
                {settings.apiProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
              </select>
            </label>
            <label className="text-[10px] opacity-60">摘要模型
              <select value={selectedModel} onChange={e => patch({ profileId: selectedProfile?.id, modelId: e.target.value })}
                className={`mt-1 w-full rounded-xl border px-3 py-2 text-xs bg-transparent ${n ? 'border-night-border' : 'border-gray-200'}`}>
                {(selectedProfile?.models || []).map(model => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}
              </select>
            </label>
          </div>
          <div className={`rounded-xl px-3 py-2 text-[11px] ${n ? 'bg-night-bg/60' : 'bg-[#fff6f3]'}`}>
            最新未整理对话：{pendingRounds} 轮 · {config.autoEnabled ? (autoRemaining ? `还差 ${autoRemaining} 轮（至少 ${autoRemaining * 2} 条消息）会自动生成` : '已达到自动整理条件') : '自动整理已关闭'}
          </div>
          <button onClick={onGenerate} disabled={generating || !enough} className={`w-full py-2.5 rounded-xl text-sm flex justify-center items-center gap-2 disabled:opacity-50 ${n ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}>
            {generating ? <Loader2 size={15} className="animate-spin"/> : <FileText size={15}/>} {enough ? `倒序整理最近 ${config.turnSize} 轮` : `还差 ${autoRemaining} 轮 / 至少 ${autoRemaining * 2} 条`}
          </button>
          <p className="text-[10px] opacity-45">每轮从一条小火消息开始，包含随后星星的回复及工具过程。已整理区间不会重复；手动整理也优先选择离当前最近的完整区间。</p>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between text-xs"><span className="font-medium">最近的记忆卡</span><span className="opacity-45">前端最多 5 张 · 永久共 {summaries.length} 张</span></div>
          {archivedCount > 0 && <div className="flex items-center gap-2 text-[10px] opacity-45"><Archive size={12}/> 另有 {archivedCount} 张已永久归档，不在前端显示</div>}
          {!visibleSummaries.length && <div className="text-center py-8 text-xs opacity-40">还没有摘要。再聊一会儿，第一张记忆卡就会出现。</div>}
          {visibleSummaries.map((s: ChatSummary) => <div key={s.id} className={`rounded-2xl border p-4 space-y-2 ${card}`}>
            <div className="flex items-start justify-between gap-3"><div className="text-[11px] font-medium opacity-65">{formatMadrid(s.startAt, false)} — {formatMadrid(s.endAt, false)} · {s.turnCount}轮 / {s.messageCount || s.sourceMessageIds?.length || s.turnCount * 2}条</div>
              <button onClick={() => session && deleteSummary(session.id, s.id)} className="p-1 opacity-35 hover:opacity-100 hover:text-red-500"><Trash2 size={13}/></button></div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{s.eventSummary}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
              <div className={`rounded-xl px-3 py-2 ${n ? 'bg-night-bg/60' : 'bg-[#fff6f3]'}`}><span className="opacity-45">小火的情绪</span><br/>{s.fireEmotion || '未明显表达'}</div>
              <div className={`rounded-xl px-3 py-2 ${n ? 'bg-night-bg/60' : 'bg-[#fffaf0]'}`}><span className="opacity-45">星星的情绪</span><br/>{s.starEmotion || '未明显表达'}</div>
            </div>
          </div>)}
        </div>
      </div>
    </motion.div>
  </>}</AnimatePresence>
}
