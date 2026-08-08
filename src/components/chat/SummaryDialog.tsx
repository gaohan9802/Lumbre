'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { FileText, Loader2, Trash2, X } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { ChatSession, ChatSummary, useChatStore } from '@/lib/chatStore'
import { formatMadrid } from '@/lib/madrid-time'

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
  const { settings, setSettings, deleteSummary } = useChatStore()
  const summaries = [...(session?.summaries || [])].sort((a, b) => b.endAt - a.endAt)
  const chronological = [...(session?.summaries || [])].sort((a, b) => a.endAt - b.endAt)
  const lastCovered = chronological[chronological.length - 1]?.coveredUntilMessageId
  const coveredIndex = lastCovered ? (session?.messages || []).findIndex((m) => m.id === lastCovered) : -1
  const pendingMessages = (session?.messages || []).slice(coveredIndex + 1).length
  const pendingTurns = Math.floor(pendingMessages / 2)
  const enough = pendingMessages >= settings.summaryTurnSize * 2
  const card = n ? 'bg-night-surface border-night-border' : 'bg-white border-gray-200'

  return <AnimatePresence>{open && <>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[72] bg-black/40 backdrop-blur-sm" />
    <motion.div initial={{ opacity: 0, scale: .96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .96, y: 12 }}
      className={`fixed z-[73] inset-x-0 mx-auto w-[min(540px,calc(100vw-2rem))] max-h-[82dvh] overflow-y-auto rounded-2xl shadow-2xl ${n ? 'bg-night-card text-night-text' : 'bg-[#faf9f5] text-day-text'}`}
      style={{ top: 'max(calc(env(safe-area-inset-top, 0px) + 8dvh), 8dvh)' }}>
      <div className="sticky top-0 z-10 px-5 py-4 flex items-center justify-between backdrop-blur-md bg-inherit border-b border-current/10">
        <div><h3 className="text-lg font-medium flex items-center gap-2"><FileText size={18}/> 摘要</h3><p className="text-[10px] opacity-50 mt-0.5">把长对话折成星星能随身带着的记忆卡</p></div>
        <button onClick={onClose} className="p-2 opacity-60 hover:opacity-100"><X size={20}/></button>
      </div>
      <div className="p-5 space-y-5">
        <div className={`rounded-2xl border p-4 space-y-4 ${card}`}>
          <div>
            <div className="text-xs font-medium mb-2">每段整理多少</div>
            <div className="grid grid-cols-3 gap-2">{([20,30,40] as const).map(v => <button key={v} onClick={() => setSettings({ summaryTurnSize: v })}
              className={`py-2 rounded-xl text-xs border ${settings.summaryTurnSize === v ? (n ? 'border-night-amber bg-night-amber/15 text-night-amber' : 'border-day-pink bg-day-pinkLight text-day-pink') : 'border-current/10 opacity-60'}`}>{v}轮</button>)}</div>
          </div>
          <div>
            <div className="text-xs font-medium mb-2">带入对话的摘要</div>
            <div className="grid grid-cols-3 gap-2">{([3,4,5] as const).map(v => <button key={v} onClick={() => setSettings({ summaryInjectCount: v })}
              className={`py-2 rounded-xl text-xs border ${settings.summaryInjectCount === v ? (n ? 'border-night-amber bg-night-amber/15 text-night-amber' : 'border-day-pink bg-day-pinkLight text-day-pink') : 'border-current/10 opacity-60'}`}>+{v}张</button>)}</div>
          </div>
          <button onClick={onGenerate} disabled={generating || !enough} className={`w-full py-2.5 rounded-xl text-sm flex justify-center items-center gap-2 disabled:opacity-50 ${n ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}>
            {generating ? <Loader2 size={15} className="animate-spin"/> : <FileText size={15}/>} {enough ? '整理下一段' : `还差 ${Math.max(0, settings.summaryTurnSize - pendingTurns)} 轮`}
          </button>
          <p className="text-[10px] opacity-45">每“轮”按一条小火消息 + 一条星星回复计算。对话达到设定长度后也会自动整理；已经整理过的消息不会重复。</p>
        </div>

        <div className="space-y-3">
          <div className="flex justify-between text-xs"><span className="font-medium">记忆卡</span><span className="opacity-45">共 {summaries.length} 张 · 自动带入最近 {settings.summaryInjectCount} 张</span></div>
          {!summaries.length && <div className="text-center py-8 text-xs opacity-40">还没有摘要。再聊一会儿，第一张记忆卡就会出现。</div>}
          {summaries.map((s: ChatSummary) => <div key={s.id} className={`rounded-2xl border p-4 space-y-2 ${card}`}>
            <div className="flex items-start justify-between gap-3"><div className="text-[11px] font-medium opacity-65">{formatMadrid(s.startAt, false)} — {formatMadrid(s.endAt, false)}</div>
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
