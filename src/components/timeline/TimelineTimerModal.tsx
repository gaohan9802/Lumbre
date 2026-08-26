'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Play, Square } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { timeline as timelineApi } from '@/lib/api'

export interface TimelineCurrent {
  id: string; title: string; tags: string[]; note?: string; start_at: string; end_at?: string
}

export function TimelineTimerModal({ open, current, availableTags = ['学习','工作','外出','娱乐','家务','旅行','阅读','运动'], onClose, onChanged }: {
  open: boolean; current: TimelineCurrent | null; availableTags?: string[]; onClose: () => void; onChanged: (record?: TimelineCurrent | null) => void
}) {
  const { theme } = useTheme(); const n = theme === 'night'
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [endNote, setEndNote] = useState('')
  const [stage, setStage] = useState<'main'|'end-note'>('main')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (open) { setStage('main'); setError(''); setEndNote('') } }, [open])
  if (!open || typeof document === 'undefined') return null

  const start = async () => {
    if (!title.trim()) return setError('先写下要做什么')
    if (!tags.length) return setError('请选择至少一个标签')
    setBusy(true); setError('')
    const data = await timelineApi.start(title.trim(), tags, note)
    setBusy(false)
    if (data.error) return setError(data.error)
    setTitle(''); setTags([]); setNote(''); onChanged(data.record); onClose()
  }
  const stop = async () => {
    if (!current) return
    setBusy(true); setError('')
    const data = await timelineApi.stop(current.id, endNote)
    setBusy(false)
    if (data.error) return setError(data.error)
    onChanged(null); onClose()
  }

  return createPortal(<>
    <div className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-sm" onClick={onClose}/>
    <div className={`fixed z-[81] inset-x-4 mx-auto top-[max(calc(env(safe-area-inset-top)+12dvh),12dvh)] max-w-md rounded-[1.6rem] border p-5 shadow-2xl ${n ? 'bg-night-surface border-night-border text-night-text' : 'bg-white border-day-border text-day-text'}`}>
      <div className="flex items-center justify-between mb-4"><div><h3 className="font-semibold text-base">{current ? '结束这段时间？' : '开始做一件事'}</h3><p className={`text-[10px] mt-1 ${n?'text-night-muted':'text-day-muted'}`}>时间会从点击开始后正向流动</p></div><button onClick={onClose} className="p-2 rounded-full opacity-60 hover:opacity-100"><X size={17}/></button></div>
      {current ? stage === 'main' ? <div className="space-y-4">
        <div className={`rounded-2xl p-4 ${n?'bg-night-bg/60':'bg-day-pinkLight'}`}><div className="text-[10px] opacity-55">正在做</div><div className="mt-1 font-medium">{current.title}</div>{current.tags?.length>0&&<div className="mt-2 flex flex-wrap gap-1">{current.tags.map(t=><span key={t} className="text-[9px] opacity-65">#{t}</span>)}</div>}</div>
        <div className="grid grid-cols-2 gap-2"><button onClick={onClose} className={`py-2.5 rounded-xl border ${n?'border-night-border':'border-day-border'}`}>取消</button><button onClick={()=>setStage('end-note')} className={`py-2.5 rounded-xl flex items-center justify-center gap-2 ${n?'bg-night-amber text-night-bg':'bg-day-pink text-white'}`}><Square size={13}/>确定结束</button></div>
      </div> : <div className="space-y-3">
        <label className="block text-xs">结束备注 <span className="opacity-45">（选填）</span></label>
        <textarea value={endNote} onChange={e=>setEndNote(e.target.value)} rows={4} placeholder="完成了什么、现在感觉如何……" className={`no-frame w-full resize-none rounded-xl border px-3 py-2 outline-none ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/>
        {error&&<p className="text-xs text-red-500">{error}</p>}
        <div className="grid grid-cols-2 gap-2"><button onClick={()=>setStage('main')} className={`py-2.5 rounded-xl border ${n?'border-night-border':'border-day-border'}`}>返回</button><button disabled={busy} onClick={stop} className={`py-2.5 rounded-xl ${n?'bg-night-amber text-night-bg':'bg-day-pink text-white'}`}>{busy?'保存中…':'结束并保存'}</button></div>
      </div> : <div className="space-y-3">
        <div><label className="text-xs">我要开始做什么 *</label><input autoFocus value={title} onChange={e=>setTitle(e.target.value)} placeholder="例如：写论文" className={`no-frame mt-1 w-full rounded-xl border px-3 py-2.5 outline-none ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/></div>
        <div><label className="text-xs">标签 <span className="opacity-45">（必选，可多选）</span></label><div className="mt-2 flex flex-wrap gap-2">{availableTags.map(tag=><button type="button" key={tag} onClick={()=>setTags(tags.includes(tag)?tags.filter(x=>x!==tag):[...tags,tag])} className={`rounded-full border px-3 py-1.5 text-xs transition ${tags.includes(tag)?(n?'border-night-amber bg-night-amber/20 text-night-amber':'border-day-pink bg-day-pinkLight text-day-text'):(n?'border-night-border':'border-day-border')}`}>{tag}</button>)}</div></div>
        <div><label className="text-xs">备注 <span className="opacity-45">（选填）</span></label><textarea value={note} onChange={e=>setNote(e.target.value)} rows={3} placeholder="这次想完成到哪里……" className={`no-frame mt-1 w-full resize-none rounded-xl border px-3 py-2 outline-none ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/></div>
        {error&&<p className="text-xs text-red-500">{error}</p>}
        <button disabled={busy||!title.trim()} onClick={start} className={`w-full py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-35 ${n?'bg-night-amber text-night-bg':'bg-day-pink text-white'}`}><Play size={14}/>{busy?'开始中…':'开始计时'}</button>
      </div>}
    </div>
  </>, document.body)
}
