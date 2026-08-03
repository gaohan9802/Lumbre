'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Clock3, Pencil, Trash2, X, Save } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { timeline as timelineApi } from '@/lib/api'
import { TimelineTimerModal, TimelineCurrent } from './TimelineTimerModal'

type RecordT = TimelineCurrent & { end_note?: string; duration_seconds: number; updated_at?: string }
const pad=(n:number)=>String(n).padStart(2,'0')
const dayKey=(d:Date)=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
const dayBounds=(date:string)=>{const [y,m,d]=date.split('-').map(Number);const a=new Date(y,m-1,d);const b=new Date(y,m-1,d+1);return [a.toISOString(),b.toISOString()]}
const fmtTime=(v:string)=>new Date(v).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})
const fmtDuration=(s:number)=>{const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h?`${h}小时${m?m+'分':''}`:`${Math.max(1,m)}分钟`}
const COLORS=['#EF4067','#84BECA','#e2a84b','#4a9e7e','#9b7bb8','#d4915c','#6e9fb4','#be6d7d']

export function TimelineView(){
  const {theme}=useTheme(); const n=theme==='night'
  const [date,setDate]=useState(dayKey(new Date()))
  const [records,setRecords]=useState<RecordT[]>([])
  const [weekRecords,setWeekRecords]=useState<RecordT[]>([])
  const [current,setCurrent]=useState<TimelineCurrent|null>(null)
  const [timerOpen,setTimerOpen]=useState(false)
  const [editing,setEditing]=useState<RecordT|null>(null)
  const [loading,setLoading]=useState(true)
  const selected=new Date(date+'T12:00:00')
  const monday=useMemo(()=>{const d=new Date(selected);const wd=(d.getDay()+6)%7;d.setDate(d.getDate()-wd);d.setHours(0,0,0,0);return d},[date])
  const load=useCallback(async()=>{
    setLoading(true)
    const [from,to]=dayBounds(date);const weekEnd=new Date(monday);weekEnd.setDate(weekEnd.getDate()+7)
    const [day,week]=await Promise.all([timelineApi.list(from,to),timelineApi.list(monday.toISOString(),weekEnd.toISOString())])
    setRecords(day.records||[]);setWeekRecords(week.records||[]);setCurrent(day.current||week.current||null);setLoading(false)
  },[date,monday])
  useEffect(()=>{load();const t=setInterval(load,30000);return()=>clearInterval(t)},[load])
  const move=(days:number)=>{const d=new Date(selected);d.setDate(d.getDate()+days);setDate(dayKey(d))}
  const dayStart=new Date(date+'T00:00:00').getTime(); const nextDay=new Date(dayStart); nextDay.setDate(nextDay.getDate()+1); const dayEnd=nextDay.getTime()
  const blocks=records.map((r,i)=>{const s=Math.max(dayStart,new Date(r.start_at).getTime());const e=Math.min(dayEnd,r.end_at?new Date(r.end_at).getTime():Date.now());return{r,top:((s-dayStart)/86400000)*100,height:Math.max(1.3,((Math.max(s,e)-s)/86400000)*100),color:COLORS[i%COLORS.length]}})
  const pie=useMemo(()=>{const map=new Map<string,number>();const ws=monday.getTime(),we=ws+7*86400000;for(const r of weekRecords){const s=Math.max(ws,new Date(r.start_at).getTime()),e=Math.min(we,r.end_at?new Date(r.end_at).getTime():Date.now());if(e>s)map.set(r.title,(map.get(r.title)||0)+(e-s)/1000)}return Array.from(map.entries()).sort((a,b)=>b[1]-a[1])},[weekRecords,monday])
  const pieTotal=pie.reduce((a,b)=>a+b[1],0);let acc=0;const stops=pie.map(([_,v],i)=>{const a=acc/pieTotal*360;acc+=v;return`${COLORS[i%COLORS.length]} ${a}deg ${acc/pieTotal*360}deg`}).join(', ')
  const saveEdit=async()=>{if(!editing)return;await timelineApi.update(editing.id,{title:editing.title,tags:editing.tags,note:editing.note,end_note:editing.end_note,start_at:new Date(editing.start_at).toISOString(),end_at:editing.end_at?new Date(editing.end_at).toISOString():undefined});setEditing(null);load()}
  const remove=async(r:RecordT)=>{if(!confirm(`删除「${r.title}」这条记录？`))return;await timelineApi.remove(r.id);load()}
  return <div className={`h-full overflow-y-auto ${n?'bg-night-bg text-night-text':'bg-day-bg text-day-text'}`}>
    <div className="max-w-6xl mx-auto px-4 md:px-7 py-6 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6"><div><h1 className="font-serif text-2xl">Timeline</h1><p className={`text-xs mt-1 ${n?'text-night-muted':'text-day-muted'}`}>一天不是被切碎的，是一段一段活过来的。</p></div><button onClick={()=>setTimerOpen(true)} className={`px-4 py-2.5 rounded-xl flex items-center gap-2 ${n?'bg-night-amber text-night-bg':'bg-day-pink text-white'}`}><Clock3 size={15}/>{current?'查看当前状态':'开始一件事'}</button></div>
      {current&&<button onClick={()=>setTimerOpen(true)} className={`w-full mb-5 p-4 rounded-2xl border text-left ${n?'bg-night-card border-night-amber/25':'bg-white border-day-pink/20 shadow-sm'}`}><div className="text-[10px] opacity-50">此刻正在</div><div className="font-medium mt-1">{current.title}</div><div className="text-xs opacity-55 mt-1">从 {fmtTime(current.start_at)} 开始 · 点击结束</div></button>}
      <div className="flex items-center justify-center gap-3 mb-5"><button onClick={()=>move(-1)} className="p-2 rounded-full hover:bg-black/5"><ChevronLeft size={18}/></button><input type="date" value={date} onChange={e=>setDate(e.target.value)} className={`no-frame rounded-xl border px-3 py-2 text-sm ${n?'bg-night-card border-night-border':'bg-white border-day-border'}`}/><button onClick={()=>setDate(dayKey(new Date()))} className="text-xs opacity-60 hover:opacity-100">今天</button><button onClick={()=>move(1)} className="p-2 rounded-full hover:bg-black/5"><ChevronRight size={18}/></button></div>
      <div className="grid lg:grid-cols-[1.45fr_0.8fr] gap-5">
        <section className={`rounded-3xl border p-4 md:p-6 ${n?'bg-night-card border-night-border':'bg-white border-day-border shadow-sm'}`}>
          <div className="flex justify-between items-end mb-4"><div><h2 className="font-medium">{date}</h2><p className="text-[10px] opacity-45 mt-1">00:00 — 24:00</p></div><span className="text-xs opacity-50">{records.length} 段记录</span></div>
          <div className="relative h-[960px] ml-11 border-l" style={{borderColor:n?'#2e3d4d':'#ead8d3'}}>
            {Array.from({length:25},(_,h)=><div key={h} className="absolute left-0 right-0 border-t" style={{top:`${h/24*100}%`,borderColor:n?'rgba(46,61,77,.55)':'rgba(234,216,211,.7)'}}><span className="absolute -left-11 -top-2 text-[9px] opacity-45 w-8 text-right">{pad(h)}:00</span></div>)}
            {blocks.map(({r,top,height,color})=><button key={r.id} onClick={()=>setEditing({...r})} className="absolute left-3 right-2 md:right-5 rounded-xl px-3 py-2 text-left overflow-hidden shadow-sm hover:brightness-105 transition" style={{top:`${top}%`,height:`${height}%`,minHeight:36,background:`${color}22`,borderLeft:`4px solid ${color}`}}><div className="font-medium text-xs truncate">{r.title}</div><div className="text-[9px] opacity-60 truncate">{fmtTime(r.start_at)}–{r.end_at?fmtTime(r.end_at):'现在'} · {fmtDuration(r.duration_seconds)}</div></button>)}
            {!loading&&records.length===0&&<div className="absolute inset-0 grid place-items-center text-xs opacity-35">这一天还没有记录</div>}
          </div>
        </section>
        <aside className="space-y-5">
          <section className={`rounded-3xl border p-5 ${n?'bg-night-card border-night-border':'bg-white border-day-border shadow-sm'}`}><h2 className="font-medium">本周时间占比</h2><p className="text-[10px] opacity-45 mt-1">{dayKey(monday)} 起的 7 天</p>{pieTotal>0?<><div className="w-48 h-48 rounded-full mx-auto my-6 relative" style={{background:`conic-gradient(${stops})`}}><div className={`absolute inset-10 rounded-full grid place-items-center text-center ${n?'bg-night-card':'bg-white'}`}><div><div className="text-lg font-semibold">{fmtDuration(pieTotal)}</div><div className="text-[9px] opacity-45">已记录</div></div></div></div><div className="space-y-2">{pie.map(([title,v],i)=><div key={title} className="flex items-center gap-2 text-xs"><span className="w-2.5 h-2.5 rounded-full" style={{background:COLORS[i%COLORS.length]}}/><span className="flex-1 truncate">{title}</span><span className="opacity-55">{Math.round(v/pieTotal*100)}% · {fmtDuration(v)}</span></div>)}</div></>:<div className="py-16 text-center text-xs opacity-35">本周还没有完整的时间记录</div>}</section>
          <section className={`rounded-3xl border p-5 ${n?'bg-night-card border-night-border':'bg-white border-day-border shadow-sm'}`}><h2 className="font-medium mb-3">当天记录</h2><div className="space-y-2">{records.map(r=><div key={r.id} className={`rounded-xl p-3 ${n?'bg-night-bg/55':'bg-day-bg'}`}><div className="flex gap-2"><div className="flex-1 min-w-0"><div className="text-sm truncate">{r.title}</div><div className="text-[10px] opacity-50 mt-1">{fmtTime(r.start_at)}–{r.end_at?fmtTime(r.end_at):'现在'} · {fmtDuration(r.duration_seconds)}</div></div><button onClick={()=>setEditing({...r})} className="p-1.5 opacity-45 hover:opacity-100"><Pencil size={13}/></button><button onClick={()=>remove(r)} className="p-1.5 opacity-35 hover:opacity-100 text-red-500"><Trash2 size={13}/></button></div>{r.tags?.length>0&&<div className="mt-2 text-[9px] opacity-45">{r.tags.map(t=>`#${t}`).join(' ')}</div>}{r.note&&<p className="text-[10px] mt-2 opacity-60">开始：{r.note}</p>}{r.end_note&&<p className="text-[10px] mt-1 opacity-60">结束：{r.end_note}</p>}</div>)}</div></section>
        </aside>
      </div>
    </div>
    <TimelineTimerModal open={timerOpen} current={current} onClose={()=>setTimerOpen(false)} onChanged={()=>load()}/>
    {editing&&<><div className="fixed inset-0 z-[80] bg-black/45" onClick={()=>setEditing(null)}/><div className={`fixed z-[81] inset-x-4 mx-auto top-[10dvh] max-w-lg rounded-3xl border p-5 max-h-[80dvh] overflow-y-auto ${n?'bg-night-surface border-night-border':'bg-white border-day-border'}`}><div className="flex justify-between mb-4"><h3 className="font-medium">编辑记录</h3><button onClick={()=>setEditing(null)}><X size={17}/></button></div><div className="space-y-3 text-xs"><label className="block">事情<input value={editing.title} onChange={e=>setEditing({...editing,title:e.target.value})} className={`no-frame mt-1 w-full rounded-xl border px-3 py-2 ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/></label><label className="block">标签<input value={editing.tags.join(', ')} onChange={e=>setEditing({...editing,tags:e.target.value.split(/[,，\s]+/).filter(Boolean)})} className={`no-frame mt-1 w-full rounded-xl border px-3 py-2 ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/></label><div className="grid grid-cols-2 gap-2"><label>开始<input type="datetime-local" value={new Date(new Date(editing.start_at).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)} onChange={e=>setEditing({...editing,start_at:e.target.value})} className={`no-frame mt-1 w-full rounded-xl border px-2 py-2 ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/></label><label>结束<input type="datetime-local" value={editing.end_at?new Date(new Date(editing.end_at).getTime()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16):''} onChange={e=>setEditing({...editing,end_at:e.target.value||undefined})} className={`no-frame mt-1 w-full rounded-xl border px-2 py-2 ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/></label></div><label className="block">开始备注<textarea value={editing.note||''} onChange={e=>setEditing({...editing,note:e.target.value})} rows={3} className={`no-frame mt-1 w-full rounded-xl border px-3 py-2 ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/></label><label className="block">结束备注<textarea value={editing.end_note||''} onChange={e=>setEditing({...editing,end_note:e.target.value})} rows={3} className={`no-frame mt-1 w-full rounded-xl border px-3 py-2 ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/></label><button onClick={saveEdit} className={`w-full py-3 rounded-xl flex justify-center items-center gap-2 ${n?'bg-night-amber text-night-bg':'bg-day-pink text-white'}`}><Save size={14}/>保存修改</button></div></div></>}
  </div>
}
