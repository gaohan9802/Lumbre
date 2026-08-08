'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Archive, ChevronDown, ChevronRight, FileText, Flag, Loader2, Lock, Pencil, RotateCcw, Save, Trash2, Unlock, X } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { ChatSession, ChatSummary, SummaryStructure, useChatStore } from '@/lib/chatStore'
import { formatMadrid } from '@/lib/madrid-time'
import { newestPendingRounds, selectReverseSummarySegment } from '@/lib/chat-summary'

interface Props {
  open: boolean
  onClose: () => void
  session?: ChatSession
  generating?: boolean
  stageGenerating?: boolean
  onGenerate: () => void
  onRegenerate: (summary: ChatSummary) => void
}

const STRUCTURE_FIELDS: { key: keyof SummaryStructure; label: string }[] = [
  { key: 'facts', label: '确认事实' }, { key: 'agreements', label: '约定与承诺' },
  { key: 'preferences', label: '偏好变化' }, { key: 'unfinished', label: '未完成事项' },
  { key: 'cautions', label: '需要避免' }, { key: 'relationshipChanges', label: '关系状态变化' },
  { key: 'followUps', label: '后续追踪' },
]

const emptyStructure = (): SummaryStructure => ({ facts: [], agreements: [], preferences: [], unfinished: [], cautions: [], relationshipChanges: [], followUps: [] })

export function SummaryDialog({ open, onClose, session, generating, stageGenerating, onGenerate, onRegenerate }: Props) {
  const { theme } = useTheme()
  const n = theme === 'night'
  const { settings, deleteSummary, updateSummary, updateSessionSummaryConfig } = useChatStore()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<ChatSummary | null>(null)
  const config = session?.summaryConfig || { autoEnabled: true, turnSize: settings.summaryTurnSize, injectCount: settings.summaryInjectCount, profileId: undefined, modelId: undefined }
  const summaries = [...(session?.summaries || [])].sort((a, b) => b.endAt - a.endAt)
  const stages = [...(session?.stageSummaries || [])].sort((a, b) => b.endAt - a.endAt)
  const visibleSummaries = summaries.slice(0, 5)
  const archivedCount = Math.max(0, summaries.length - visibleSummaries.length)
  const pendingRounds = newestPendingRounds(session?.messages || [], session?.summaries || [])
  const autoRemaining = Math.max(0, config.turnSize - pendingRounds)
  const enough = !!selectReverseSummarySegment(session?.messages || [], session?.summaries || [], config.turnSize, false).length
  const selectedProfile = settings.apiProfiles.find(profile => profile.id === config.profileId) || settings.apiProfiles.find(profile => profile.id === settings.activeProfileId) || settings.apiProfiles[0]
  const selectedModel = config.modelId || (selectedProfile?.id === settings.activeProfileId ? settings.model : selectedProfile?.defaultModel) || selectedProfile?.models[0]?.id || ''
  const card = n ? 'bg-night-surface border-night-border' : 'bg-white border-gray-200'
  const soft = n ? 'bg-night-bg/60' : 'bg-[#fff6f3]'
  const patch = (value: any) => session && updateSessionSummaryConfig(session.id, value)
  const toggle = (id: string) => setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  const beginEdit = (summary: ChatSummary) => { setEditing(summary.id); setDraft({ ...summary, structure: { ...emptyStructure(), ...(summary.structure || {}) } }); setExpanded(prev => new Set(prev).add(summary.id)) }
  const saveEdit = () => { if (!session || !draft) return; updateSummary(session.id, draft.id, { eventSummary: draft.eventSummary.trim(), fireEmotion: draft.fireEmotion.trim(), starEmotion: draft.starEmotion.trim(), structure: draft.structure, editedAt: Date.now(), needsCorrection: false }); setEditing(null); setDraft(null) }
  const setList = (key: keyof SummaryStructure, text: string) => setDraft(prev => prev ? ({ ...prev, structure: { ...emptyStructure(), ...(prev.structure || {}), [key]: text.split('\n').map(x => x.trim()).filter(Boolean) } }) : prev)

  return <AnimatePresence>{open && <>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-[72] bg-black/40 backdrop-blur-sm" />
    <motion.div initial={{ opacity: 0, scale: .96, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .96, y: 12 }}
      className={`fixed z-[73] inset-x-0 mx-auto w-[min(600px,calc(100vw-2rem))] max-h-[82dvh] overflow-y-auto rounded-2xl shadow-2xl ${n ? 'bg-night-card text-night-text' : 'bg-[#faf9f5] text-day-text'}`}
      style={{ top: 'max(calc(env(safe-area-inset-top, 0px) + 8dvh), 8dvh)' }}>
      <div className="sticky top-0 z-10 px-5 py-4 flex items-center justify-between backdrop-blur-md bg-inherit border-b border-current/10">
        <div><h3 className="text-lg font-medium flex items-center gap-2"><FileText size={18}/> 摘要</h3><p className="text-[10px] opacity-50 mt-0.5">卡片默认折叠 · 点击标题展开 · 当前对话独立设置</p></div>
        <button onClick={onClose} className="p-2 opacity-60 hover:opacity-100"><X size={20}/></button>
      </div>
      <div className="p-5 space-y-5">
        <div className={`rounded-2xl border p-4 space-y-4 ${card}`}>
          <div className="flex items-center justify-between gap-4"><div><div className="text-xs font-medium">自动整理</div><div className="text-[10px] opacity-45 mt-1">每 10 张普通摘要自动生成 1 张阶段摘要，原卡不会删除</div></div>
            <button type="button" onClick={() => patch({ autoEnabled: !config.autoEnabled })} className={`relative w-11 h-6 rounded-full transition-colors ${config.autoEnabled ? (n ? 'bg-night-amber' : 'bg-day-pink') : 'bg-current/15'}`}><span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${config.autoEnabled ? 'translate-x-6' : 'translate-x-1'}`}/></button></div>
          <div><div className="text-xs font-medium mb-2">每张摘要整理多少轮</div><div className="grid grid-cols-3 gap-2">{([20,30,40] as const).map(v => <button key={v} onClick={() => patch({ turnSize: v })} className={`py-2 rounded-xl text-xs border ${config.turnSize === v ? (n ? 'border-night-amber bg-night-amber/15 text-night-amber' : 'border-day-pink bg-day-pinkLight text-day-pink') : 'border-current/10 opacity-60'}`}>{v}轮</button>)}</div></div>
          <div><div className="text-xs font-medium mb-2">带入对话的普通摘要</div><div className="grid grid-cols-3 gap-2">{([3,4,5] as const).map(v => <button key={v} onClick={() => patch({ injectCount: v })} className={`py-2 rounded-xl text-xs border ${config.injectCount === v ? (n ? 'border-night-amber bg-night-amber/15 text-night-amber' : 'border-day-pink bg-day-pinkLight text-day-pink') : 'border-current/10 opacity-60'}`}>+{v}张</button>)}</div></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="text-[10px] opacity-60">摘要 API<select value={selectedProfile?.id || ''} onChange={e => { const profile = settings.apiProfiles.find(item => item.id === e.target.value); patch({ profileId: profile?.id, modelId: profile?.defaultModel || profile?.models[0]?.id }) }} className={`mt-1 w-full rounded-xl border px-3 py-2 text-xs bg-transparent ${n ? 'border-night-border' : 'border-gray-200'}`}>{settings.apiProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>
            <label className="text-[10px] opacity-60">摘要模型<select value={selectedModel} onChange={e => patch({ profileId: selectedProfile?.id, modelId: e.target.value })} className={`mt-1 w-full rounded-xl border px-3 py-2 text-xs bg-transparent ${n ? 'border-night-border' : 'border-gray-200'}`}>{(selectedProfile?.models || []).map(model => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}</select></label>
          </div>
          <div className={`rounded-xl px-3 py-2 text-[11px] ${soft}`}>最新未整理对话：{pendingRounds} 轮 · {config.autoEnabled ? (autoRemaining ? `还差 ${autoRemaining} 轮（至少 ${autoRemaining * 2} 条消息）会自动生成` : '已达到自动整理条件') : '自动整理已关闭'}{stageGenerating ? ' · 正在生成阶段摘要…' : ''}</div>
          <button onClick={onGenerate} disabled={generating || !enough} className={`w-full py-2.5 rounded-xl text-sm flex justify-center items-center gap-2 disabled:opacity-50 ${n ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}>{generating ? <Loader2 size={15} className="animate-spin"/> : <FileText size={15}/>} {enough ? `倒序整理最近 ${config.turnSize} 轮` : `还差 ${autoRemaining} 轮 / 至少 ${autoRemaining * 2} 条`}</button>
        </div>

        {!!stages.length && <div className="space-y-2"><div className="flex justify-between text-xs"><span className="font-medium">阶段摘要</span><span className="opacity-45">每 10 张普通摘要合成 · 共 {stages.length} 张</span></div>{stages.slice(0, 3).map(stage => <div key={stage.id} className={`rounded-2xl border ${card}`}><button onClick={() => toggle(stage.id)} className="w-full p-4 flex items-center gap-2 text-left">{expanded.has(stage.id) ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}<div className="min-w-0"><div className="text-sm font-medium truncate">{stage.title}</div><div className="text-[10px] opacity-45">{formatMadrid(stage.startAt, false)} — {formatMadrid(stage.endAt, false)} · 10 张来源卡</div></div></button>{expanded.has(stage.id) && <div className="px-4 pb-4 space-y-3"><p className="text-sm leading-relaxed whitespace-pre-wrap">{stage.overview}</p><StructureView structure={stage.structure} soft={soft}/></div>}</div>)}</div>}

        <div className="space-y-3">
          <div className="flex justify-between text-xs"><span className="font-medium">最近的记忆卡</span><span className="opacity-45">最多显示 5 张 · 永久共 {summaries.length} 张</span></div>
          {archivedCount > 0 && <div className="flex items-center gap-2 text-[10px] opacity-45"><Archive size={12}/> 另有 {archivedCount} 张已永久归档</div>}
          {!visibleSummaries.length && <div className="text-center py-8 text-xs opacity-40">还没有摘要。再聊一会儿，第一张记忆卡就会出现。</div>}
          {visibleSummaries.map(s => { const isOpen = expanded.has(s.id); const editDraft = editing === s.id ? draft : null; return <div key={s.id} className={`rounded-2xl border ${card} ${s.needsCorrection ? 'ring-1 ring-red-400/60' : ''}`}>
            <div className="p-3 flex items-start gap-2"><button onClick={() => toggle(s.id)} className="p-1 opacity-60">{isOpen ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</button><button onClick={() => toggle(s.id)} className="min-w-0 flex-1 text-left"><div className="text-[11px] font-medium opacity-65">{formatMadrid(s.startAt, false)} — {formatMadrid(s.endAt, false)} · {s.turnCount}轮 / {s.messageCount || s.sourceMessageIds?.length || s.turnCount * 2}条</div><div className="text-sm truncate mt-1">{s.eventSummary || '空摘要'}</div><div className="flex gap-2 mt-1 text-[9px] opacity-55">{s.locked && <span>🔒 已锁定</span>}{s.needsCorrection && <span className="text-red-500">⚑ 待纠错</span>}{s.editedAt && <span>已手动编辑</span>}</div></button>
              <button title={s.locked ? '解锁' : '锁定，防止重生成'} onClick={() => session && updateSummary(session.id, s.id, { locked: !s.locked })} className="p-1 opacity-45 hover:opacity-100">{s.locked ? <Lock size={13}/> : <Unlock size={13}/>}</button>
              <button title="标记摘要有误" onClick={() => session && updateSummary(session.id, s.id, { needsCorrection: !s.needsCorrection })} className={`p-1 hover:opacity-100 ${s.needsCorrection ? 'text-red-500' : 'opacity-35'}`}><Flag size={13}/></button>
            </div>
            {isOpen && <div className="px-4 pb-4 space-y-3 border-t border-current/10 pt-3">{editDraft ? <>
              <label className="block text-[10px] opacity-60">事件摘要<textarea value={editDraft.eventSummary} onChange={e => setDraft({ ...editDraft, eventSummary: e.target.value })} rows={5} className="mt-1 w-full rounded-xl border border-current/15 bg-transparent p-3 text-sm"/></label>
              <div className="grid sm:grid-cols-2 gap-2"><label className="text-[10px] opacity-60">小火的情绪<textarea value={editDraft.fireEmotion} onChange={e => setDraft({ ...editDraft, fireEmotion: e.target.value })} rows={2} className="mt-1 w-full rounded-xl border border-current/15 bg-transparent p-2 text-xs"/></label><label className="text-[10px] opacity-60">星星的情绪<textarea value={editDraft.starEmotion} onChange={e => setDraft({ ...editDraft, starEmotion: e.target.value })} rows={2} className="mt-1 w-full rounded-xl border border-current/15 bg-transparent p-2 text-xs"/></label></div>
              {STRUCTURE_FIELDS.map(f => <label key={f.key} className="block text-[10px] opacity-60">{f.label}（每行一条）<textarea value={(editDraft.structure?.[f.key] || []).join('\n')} onChange={e => setList(f.key, e.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-current/15 bg-transparent p-2 text-xs"/></label>)}
              <div className="flex gap-2"><button onClick={saveEdit} className={`flex-1 py-2 rounded-xl text-xs flex items-center justify-center gap-1 ${n ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}><Save size={13}/> 保存纠错</button><button onClick={() => { setEditing(null); setDraft(null) }} className="px-4 py-2 rounded-xl border border-current/15 text-xs">取消</button></div>
            </> : <><p className="text-sm leading-relaxed whitespace-pre-wrap">{s.eventSummary}</p><div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]"><div className={`rounded-xl px-3 py-2 ${soft}`}><span className="opacity-45">小火的情绪</span><br/>{s.fireEmotion || '未明显表达'}</div><div className={`rounded-xl px-3 py-2 ${soft}`}><span className="opacity-45">星星的情绪</span><br/>{s.starEmotion || '未明显表达'}</div></div><StructureView structure={s.structure} soft={soft}/><div className="flex flex-wrap gap-2 pt-1"><button onClick={() => beginEdit(s)} className="px-3 py-1.5 rounded-lg border border-current/15 text-[10px] flex items-center gap-1"><Pencil size={11}/> 编辑纠错</button><button disabled={generating || s.locked} onClick={() => onRegenerate(s)} className="px-3 py-1.5 rounded-lg border border-current/15 text-[10px] flex items-center gap-1 disabled:opacity-35"><RotateCcw size={11}/> {s.locked ? '已锁定' : '重新生成'}</button><button onClick={() => session && deleteSummary(session.id, s.id)} className="ml-auto px-3 py-1.5 rounded-lg text-red-500/70 text-[10px] flex items-center gap-1"><Trash2 size={11}/> 删除</button></div></>}</div>}
          </div>})}
        </div>
      </div>
    </motion.div>
  </>}</AnimatePresence>
}

function StructureView({ structure, soft }: { structure?: SummaryStructure; soft: string }) {
  if (!structure) return null
  const present = STRUCTURE_FIELDS.filter(field => structure[field.key]?.length)
  if (!present.length) return null
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">{present.map(field => <div key={field.key} className={`rounded-xl px-3 py-2 text-[11px] ${soft}`}><div className="opacity-45 mb-1">{field.label}</div><ul className="space-y-1">{structure[field.key].map((item, i) => <li key={i}>• {item}</li>)}</ul></div>)}</div>
}
