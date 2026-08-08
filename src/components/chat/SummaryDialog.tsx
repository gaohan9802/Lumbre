'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronDown, FileText, Pencil, Trash2, X } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { ChatSession, useChatStore } from '@/lib/chatStore'
import { formatMadrid } from '@/lib/madrid-time'
import { buildSummaryRounds, messagesAfterSummaryAnchor } from '@/lib/chat-summary'

export function SummaryDialog({ open, onClose, session, generating, onGenerate }: {
  open: boolean; onClose: () => void; session?: ChatSession; generating?: boolean; onGenerate: () => void
}) {
  const { theme } = useTheme(); const n = theme === 'night'
  const { settings, deleteSummary, updateSummary, updateSessionSummaryConfig } = useChatStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null); const [draft, setDraft] = useState('')
  const config = session?.summaryConfig || { autoEnabled: true, turnSize: settings.summaryTurnSize, injectCount: settings.summaryInjectCount, modeVersion: 2 as const }
  const pending = buildSummaryRounds(messagesAfterSummaryAnchor(session?.messages || [], config.anchorMessageId, config.anchorTimestamp)).length
  const summaries = [...(session?.summaries || [])].sort((a,b)=>b.endAt-a.endAt)
  const patch = (value: any) => session && updateSessionSummaryConfig(session.id, value)
  const card = n ? 'bg-night-surface border-night-border' : 'bg-white border-day-border'
  return <AnimatePresence>{open && <>
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={onClose} className="fixed inset-0 z-[72] bg-black/40 backdrop-blur-sm"/>
    <motion.div initial={{opacity:0,scale:.96,y:12}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:.96,y:12}}
      className={`fixed z-[73] inset-x-0 mx-auto w-[min(600px,calc(100vw-2rem))] max-h-[82dvh] overflow-y-auto rounded-2xl shadow-2xl ${n?'bg-night-card text-night-text':'bg-[#faf9f5] text-day-text'}`} style={{top:'max(calc(env(safe-area-inset-top,0px) + 8dvh),8dvh)'}}>
      <div className="sticky top-0 z-10 px-5 py-4 flex items-center justify-between backdrop-blur-md bg-inherit border-b border-current/10"><div><h3 className="text-lg font-medium flex items-center gap-2"><FileText size={18}/>最近的事情</h3><p className="text-[10px] opacity-50 mt-1">旧对话已经封存，只整理开启后的新内容</p></div><button onClick={onClose} className="p-2 opacity-60"><X size={20}/></button></div>
      <div className="p-5 space-y-4">
        <div className={`rounded-2xl border p-4 flex items-center justify-between gap-4 ${card}`}><div><p className="text-sm font-medium">自动整理</p><p className="text-[10px] opacity-45 mt-1">关闭期间会直接跳过，重新开启也不会补跑</p></div>
          <button onClick={()=>patch({autoEnabled:!config.autoEnabled})} className={`relative w-14 h-8 rounded-full p-1 transition-all shadow-inner flex-shrink-0 ${config.autoEnabled?(n?'bg-night-amber':'bg-gradient-to-r from-day-pink to-[#f58b9f]'):(n?'bg-night-bg border border-night-border':'bg-gray-200 border border-gray-300')}`}><motion.span layout transition={{type:'spring',stiffness:500,damping:30}} className={`block w-6 h-6 rounded-full bg-white shadow-md ${config.autoEnabled?'ml-6':'ml-0'}`}/></button></div>
        <div className={`rounded-xl px-3 py-2 text-[11px] ${n?'bg-night-bg/60':'bg-[#fff6f3]'}`}>尚未整理的新对话：{pending} 轮 · 自动阈值 {config.turnSize} 轮</div>
        <button onClick={onGenerate} disabled={generating || pending < 1} className={`w-full py-2.5 rounded-xl text-xs disabled:opacity-40 ${n?'bg-night-amber text-night-bg':'bg-day-pink text-white'}`}>{generating?'麻糍正在整理…':'整理当前新增对话'}</button>
        {!summaries.length && <div className="text-center py-10 text-xs opacity-40">还没有新摘要。已有 4000 多层历史不会被倒追整理。</div>}
        {summaries.map(item=>{const openCard=expanded.has(item.id),edit=editing===item.id;return <div key={item.id} className={`rounded-2xl border ${card}`}><button onClick={()=>setExpanded(prev=>{const x=new Set(prev);x.has(item.id)?x.delete(item.id):x.add(item.id);return x})} className="w-full p-4 flex gap-3 text-left"><ChevronDown size={15} className={`mt-0.5 transition ${openCard?'':'-rotate-90'}`}/><div className="min-w-0"><p className="text-[10px] opacity-45">{formatMadrid(item.startAt,false)} — {formatMadrid(item.endAt,false)} · {item.turnCount}轮</p><p className="text-sm truncate mt-1">{item.eventSummary}</p></div></button>{openCard&&<div className="px-4 pb-4 pl-12">{edit?<><textarea value={draft} onChange={e=>setDraft(e.target.value)} rows={10} className={`w-full rounded-xl p-3 text-xs leading-relaxed outline-none ${n?'bg-night-card':'bg-gray-50'}`}/><div className="flex justify-end gap-3 mt-2"><button onClick={()=>setEditing(null)} className="text-xs opacity-50">取消</button><button onClick={()=>{if(draft.trim()&&session)updateSummary(session.id,item.id,{eventSummary:draft.trim(),editedAt:Date.now()});setEditing(null)}} className={`text-xs flex gap-1 items-center ${n?'text-night-amber':'text-day-pink'}`}><Check size={12}/>保存</button></div></>:<><p className="text-sm leading-7 whitespace-pre-wrap">{item.eventSummary}</p><div className="flex gap-3 mt-3 opacity-55"><button onClick={()=>{setEditing(item.id);setDraft(item.eventSummary)}} className="text-[10px] flex gap-1 items-center"><Pencil size={11}/>编辑</button><button onClick={()=>session&&deleteSummary(session.id,item.id)} className="text-[10px] text-red-500 flex gap-1 items-center"><Trash2 size={11}/>删除</button></div></>}</div>}</div>})}
      </div>
    </motion.div>
  </>}</AnimatePresence>
}
