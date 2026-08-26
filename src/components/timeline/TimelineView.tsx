'use client'

import { APP_TIME_ZONE, addMadridDays, formatMadridInput, madridDayBounds, madridDateKey, madridIsoWeekday, parseMadridDateTime } from '@/lib/madrid-time'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Clock3, Pencil, Trash2, X, Save, Sparkles, Settings2, Plus, Check, RotateCcw } from 'lucide-react'
import { encouragement as encouragementApi } from '@/lib/api'
import { useTheme } from '@/lib/theme'
import { timeline as timelineApi } from '@/lib/api'
import { TimelineTimerModal, TimelineCurrent } from './TimelineTimerModal'

type RecordT = TimelineCurrent & { end_note?: string; duration_seconds: number; updated_at?: string }
const pad=(n:number)=>String(n).padStart(2,'0')
const dayKey=(d:Date)=>madridDateKey(d)
const dayBounds=(date:string)=>madridDayBounds(date)
const fmtTime=(v:string)=>new Date(v).toLocaleTimeString('zh-CN',{timeZone:APP_TIME_ZONE,hour:'2-digit',minute:'2-digit',hour12:false})
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
  const [now,setNow]=useState(Date.now())
  const [encouragements,setEncouragements]=useState<any[]>([])
  const [tags,setTags]=useState<string[]>([])
  const [tagEditor,setTagEditor]=useState(false)
  const [tagDraft,setTagDraft]=useState('')
  const [bubble,setBubble]=useState<any[]>([])
  const [settingsTab,setSettingsTab]=useState<'tags'|'encouragements'>('tags')
  const [encDraft,setEncDraft]=useState({text:'',scope:'permanent' as 'permanent'|'tags',tags:[] as string[]})
  const [editingEnc,setEditingEnc]=useState<string|null>(null)
  const [settingsBusy,setSettingsBusy]=useState(false)
  const monday=useMemo(()=>{
    const noon=parseMadridDateTime(`${date}T12:00:00`) || new Date()
    const weekday=madridIsoWeekday(noon)
    return addMadridDays(date, -(weekday-1))
  },[date])
  const load=useCallback(async()=>{
    setLoading(true)
    const [from,to]=dayBounds(date);const [weekFrom,weekTo]=madridDayBounds(monday,7)
    const [day,week]=await Promise.all([timelineApi.list(from,to),timelineApi.list(weekFrom,weekTo)])
    setRecords(day.records||[]);setWeekRecords(week.records||[]);setCurrent(day.current||week.current||null);setLoading(false)
  },[date,monday])
  useEffect(()=>{load(); const t=setInterval(load,30000); return()=>clearInterval(t)},[load])
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t)},[])
  useEffect(()=>{(async()=>{try{const d=await encouragementApi.list();setEncouragements(d.encouragements||[]);setTags(d.tags||[])}catch{}})()},[])
  useEffect(()=>{
    if(!current) { setBubble([]); return }
    const getPool = () => encouragements.filter(x => x.enabled && (x.scope === 'permanent' || x.tags?.some((v:string) => current.tags.includes(v))))
    const showOne = () => {
      const pool = getPool()
      if (!pool.length) { setBubble([]); return }
      const pick = pool[Math.floor(Math.random() * pool.length)]
      setBubble([{...pick, _key:`${pick.id}-${Date.now()}` }])
    }
    // 进入当前专注状态时，先立即显示一条；之后才进入 3–5 分钟随机刷新。
    showOne()
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const delay = 180000 + Math.floor(Math.random() * 120001)
      timer = setTimeout(() => {
        const pool = getPool()
        if (pool.length) {
          setBubble(prev => {
            const available = pool.filter(x => !prev.some(b => b.id === x.id))
            const candidates = available.length ? available : pool
            const pick = candidates[Math.floor(Math.random() * candidates.length)]
            return [{...pick, _key:`${pick.id}-${Date.now()}`}, ...prev].slice(0, 3)
          })
        }
        schedule()
      }, delay)
    }
    schedule()
    return () => clearTimeout(timer)
  },[current,encouragements])
  const saveTags=async()=>{const next=tags.map(x=>x.trim()).filter(Boolean);if(!next.length)return;setSettingsBusy(true);const d=await encouragementApi.setTags(next);setTags(d.tags||next);setSettingsBusy(false)}
  const saveEnc=async()=>{if(!encDraft.text.trim() || (encDraft.scope==='tags'&&!encDraft.tags.length))return;setSettingsBusy(true);if(editingEnc) await encouragementApi.update(editingEnc,encDraft); else await encouragementApi.create(encDraft.text,encDraft.scope,encDraft.tags);const d=await encouragementApi.list();setEncouragements(d.encouragements||[]);setEncDraft({text:'',scope:'permanent',tags:[]});setEditingEnc(null);setSettingsBusy(false)}
  const editEnc=(x:any)=>{setEditingEnc(x.id);setEncDraft({text:x.text,scope:x.scope,tags:x.tags||[]})}
  const deleteEnc=async(id:string)=>{if(!window.confirm('删除这条鼓励话？'))return;await encouragementApi.remove(id);setEncouragements(prev=>prev.filter(x=>x.id!==id));setBubble(prev=>prev.filter(x=>x.id!==id))}
  const toggleEnc=async(x:any)=>{const d=await encouragementApi.update(x.id,{enabled:!x.enabled});if(d.encouragement)setEncouragements(prev=>prev.map(v=>v.id===x.id?d.encouragement:v))}
  const addTag=()=>{const value=tagDraft.trim();if(value&&!tags.includes(value)){setTags([...tags,value]);setTagDraft('')}}
  const toggleEncTag=(tag:string)=>setEncDraft(v=>({...v,tags:v.tags.includes(tag)?v.tags.filter(x=>x!==tag):[...v.tags,tag]}))
  const move=(days:number)=>setDate(addMadridDays(date,days))
  const [dayStartIso,dayEndIso]=dayBounds(date); const dayStart=new Date(dayStartIso).getTime(); const dayEnd=new Date(dayEndIso).getTime(); const daySpan=Math.max(1,dayEnd-dayStart)
  const blocks=records.map((r,i)=>{const s=Math.max(dayStart,new Date(r.start_at).getTime());const e=Math.min(dayEnd,r.end_at?new Date(r.end_at).getTime():Date.now());return{r,top:((s-dayStart)/daySpan)*100,height:Math.max(1.3,((Math.max(s,e)-s)/daySpan)*100),color:COLORS[i%COLORS.length]}})
  const pie=useMemo(()=>{const map=new Map<string,number>();const [weekFrom,weekTo]=madridDayBounds(monday,7);const ws=new Date(weekFrom).getTime(),we=new Date(weekTo).getTime();for(const r of weekRecords){const s=Math.max(ws,new Date(r.start_at).getTime()),e=Math.min(we,r.end_at?new Date(r.end_at).getTime():Date.now());if(e>s)map.set(r.title,(map.get(r.title)||0)+(e-s)/1000)}return Array.from(map.entries()).sort((a,b)=>b[1]-a[1])},[weekRecords,monday])
  const pieTotal=pie.reduce((a,b)=>a+b[1],0);let acc=0;const stops=pie.map(([_,v],i)=>{const a=acc/pieTotal*360;acc+=v;return`${COLORS[i%COLORS.length]} ${a}deg ${acc/pieTotal*360}deg`}).join(', ')
  const saveEdit=async()=>{if(!editing)return;await timelineApi.update(editing.id,{title:editing.title,tags:editing.tags,note:editing.note,end_note:editing.end_note,start_at:parseMadridDateTime(editing.start_at)?.toISOString(),end_at:editing.end_at?parseMadridDateTime(editing.end_at)?.toISOString():undefined});setEditing(null);load()}
  const remove=async(r:RecordT)=>{if(!confirm(`删除「${r.title}」这条记录？`))return;await timelineApi.remove(r.id);load()}
  return <div className={`h-full overflow-y-auto ${n?'bg-night-bg text-night-text':'bg-[#eee5da] text-receipt-ink'}`}>
    <div className="max-w-6xl mx-auto px-4 md:px-7 py-6 pb-24">
      <div className={`flex flex-wrap items-center justify-between gap-3 mb-6 px-1 ${n?'':'font-receipt'}`}><div><p className={`text-[10px] tracking-[0.3em] mb-1 ${n?'text-night-muted':'text-receipt-ink/50'}`}>NEST · TIME DESK</p><h1 className="text-2xl font-bold">Timeline</h1></div><div className="flex items-center gap-2"><button onClick={()=>setTagEditor(true)} className={`p-2.5 rounded-xl border ${n?'border-night-border hover:bg-night-surface':'border-day-border hover:bg-day-bg'}`} title="管理标签和鼓励话"><Settings2 size={16}/></button><button onClick={()=>setTimerOpen(true)} className={`px-4 py-2.5 rounded-xl flex items-center gap-2 ${n?'bg-night-amber text-night-bg':'bg-day-pink text-white'}`}><Clock3 size={15}/>{current?'查看当前状态':'开始一件事'}</button></div></div>
      {current&&<button onClick={()=>setTimerOpen(true)} className={`w-full mb-5 p-4 rounded-lg border text-left ${n?'bg-night-card border-night-amber/25':'receipt-paper border-receipt-line shadow-lg'}`}><div className="text-[10px] opacity-50">此刻正在</div><div className="font-medium mt-1">{current.title}</div><div className="text-xs opacity-55 mt-1">从 {fmtTime(current.start_at)} 开始 · 点击结束</div></button>}
      {current && <section className={`mb-5 rounded-lg border p-5 text-center ${n?'bg-night-card border-night-border':'receipt-paper border-receipt-line shadow-lg'}`}>
        <div className="text-[10px] uppercase tracking-[0.2em] opacity-45 mb-3">正在专注 · {current.tags.join(' / ')}</div>
        <div className={`mx-auto w-56 h-56 rounded-full grid place-items-center border-[10px] ${n?'border-night-amber/70':'border-day-pink/55'}`}><div><div className="font-mono text-4xl md:text-5xl tracking-wider">{(()=>{const sec=Math.max(0,Math.floor((now-new Date(current.start_at).getTime())/1000));return `${String(Math.floor(sec/3600)).padStart(2,'0')}:${String(Math.floor(sec%3600/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`})()}</div></div></div>
        {bubble.length>0 && <div className="relative mx-auto mt-5 max-w-md space-y-2">{bubble.map((item,i)=><div key={item._key||item.id} className={`relative rounded-2xl px-4 py-3 text-sm text-left transition-all ${i===0?'':'opacity-75 scale-[.98]'} ${n?'bg-night-surface':'bg-day-pinkLight'}`}><Sparkles size={13} className="absolute left-3 top-3 opacity-60"/><span className="block px-4">{item.text}</span></div>)}</div>}
      </section>}
      <div className="flex items-center justify-center gap-3 mb-5"><button onClick={()=>move(-1)} className="p-2 rounded-full hover:bg-black/5"><ChevronLeft size={18}/></button><input type="date" value={date} onChange={e=>setDate(e.target.value)} className={`no-frame rounded-xl border px-3 py-2 text-sm ${n?'bg-night-card border-night-border':'bg-white border-day-border'}`}/><button onClick={()=>setDate(dayKey(new Date()))} className="text-xs opacity-60 hover:opacity-100">今天</button><button onClick={()=>move(1)} className="p-2 rounded-full hover:bg-black/5"><ChevronRight size={18}/></button></div>
      <div className="grid lg:grid-cols-[1.45fr_0.8fr] gap-5">
        <section className={`rounded-lg border p-4 md:p-6 ${n?'bg-night-card border-night-border':'receipt-paper border-receipt-line shadow-lg'}`}>
          <div className="flex justify-between items-end mb-4"><div><h2 className="font-medium">{date}</h2><p className="text-[10px] opacity-45 mt-1">00:00 — 24:00</p></div><span className="text-xs opacity-50">{records.length} 段记录</span></div>
          <div className="relative h-[960px] ml-11 border-l" style={{borderColor:n?'#2e3d4d':'#ead8d3'}}>
            {Array.from({length:25},(_,h)=><div key={h} className="absolute left-0 right-0 border-t" style={{top:`${h/24*100}%`,borderColor:n?'rgba(46,61,77,.55)':'rgba(234,216,211,.7)'}}><span className="absolute -left-11 -top-2 text-[9px] opacity-45 w-8 text-right">{pad(h)}:00</span></div>)}
            {blocks.map(({r,top,height,color})=><button key={r.id} onClick={()=>setEditing({...r})} className="absolute left-3 right-2 md:right-5 rounded-xl px-3 py-2 text-left overflow-hidden shadow-sm hover:brightness-105 transition" style={{top:`${top}%`,height:`${height}%`,minHeight:36,background:`${color}22`,borderLeft:`4px solid ${color}`}}><div className="font-medium text-xs truncate">{r.title}</div><div className="text-[9px] opacity-60 truncate">{fmtTime(r.start_at)}–{r.end_at?fmtTime(r.end_at):'现在'} · {fmtDuration(r.duration_seconds)}</div></button>)}
            {!loading&&records.length===0&&<div className="absolute inset-0 grid place-items-center text-xs opacity-35">这一天还没有记录</div>}
          </div>
        </section>
        <aside className="space-y-5">
          <section className={`rounded-lg border p-5 ${n?'bg-night-card border-night-border':'receipt-paper border-receipt-line shadow-lg'}`}><h2 className="font-medium">本周时间占比</h2><p className="text-[10px] opacity-45 mt-1">{monday} 起的 7 天</p>{pieTotal>0?<><div className="w-48 h-48 rounded-full mx-auto my-6 relative" style={{background:`conic-gradient(${stops})`}}><div className={`absolute inset-10 rounded-full grid place-items-center text-center ${n?'bg-night-card':'bg-white'}`}><div><div className="text-lg font-semibold">{fmtDuration(pieTotal)}</div><div className="text-[9px] opacity-45">已记录</div></div></div></div><div className="space-y-2">{pie.map(([title,v],i)=><div key={title} className="flex items-center gap-2 text-xs"><span className="w-2.5 h-2.5 rounded-full" style={{background:COLORS[i%COLORS.length]}}/><span className="flex-1 truncate">{title}</span><span className="opacity-55">{Math.round(v/pieTotal*100)}% · {fmtDuration(v)}</span></div>)}</div></>:<div className="py-16 text-center text-xs opacity-35">本周还没有完整的时间记录</div>}</section>
          <section className={`rounded-lg border p-5 ${n?'bg-night-card border-night-border':'receipt-paper border-receipt-line shadow-lg'}`}><h2 className="font-medium mb-3">当天记录</h2><div className="space-y-2">{records.map(r=><div key={r.id} className={`rounded-xl p-3 ${n?'bg-night-bg/55':'bg-day-bg'}`}><div className="flex gap-2"><div className="flex-1 min-w-0"><div className="text-sm truncate">{r.title}</div><div className="text-[10px] opacity-50 mt-1">{fmtTime(r.start_at)}–{r.end_at?fmtTime(r.end_at):'现在'} · {fmtDuration(r.duration_seconds)}</div></div><button onClick={()=>setEditing({...r})} className="p-1.5 opacity-45 hover:opacity-100"><Pencil size={13}/></button><button onClick={()=>remove(r)} className="p-1.5 opacity-35 hover:opacity-100 text-red-500"><Trash2 size={13}/></button></div>{r.tags?.length>0&&<div className="mt-2 text-[9px] opacity-45">{r.tags.map(t=>`#${t}`).join(' ')}</div>}{r.note&&<p className="text-[10px] mt-2 opacity-60">开始：{r.note}</p>}{r.end_note&&<p className="text-[10px] mt-1 opacity-60">结束：{r.end_note}</p>}</div>)}</div></section>
        </aside>
      </div>
    </div>
    <TimelineTimerModal open={timerOpen} availableTags={tags} current={current} onClose={()=>setTimerOpen(false)} onChanged={()=>load()}/>
    {tagEditor&&<><div className="fixed inset-0 z-[80] bg-black/45 backdrop-blur-sm" onClick={()=>setTagEditor(false)}/><div className={`fixed z-[81] inset-x-4 mx-auto top-[7dvh] max-w-2xl max-h-[86dvh] overflow-y-auto rounded-[1.6rem] border p-5 shadow-2xl ${n?'bg-night-surface border-night-border text-night-text':'bg-white border-day-border text-day-text'}`}>
      <div className="flex items-start justify-between mb-5"><div><h3 className="font-serif text-xl">Timeline 设置</h3><p className="text-xs opacity-50 mt-1">把时间里的小提醒，整理成自己的语气。</p></div><button onClick={()=>setTagEditor(false)} className="p-2 rounded-full opacity-60 hover:opacity-100"><X size={18}/></button></div>
      <div className={`flex gap-1 p-1 rounded-xl mb-5 ${n?'bg-night-bg':'bg-day-bg'}`}><button onClick={()=>setSettingsTab('tags')} className={`flex-1 rounded-lg py-2 text-xs ${settingsTab==='tags'?(n?'bg-night-amber text-night-bg':'bg-white shadow-sm'):''}`}>标签管理</button><button onClick={()=>setSettingsTab('encouragements')} className={`flex-1 rounded-lg py-2 text-xs ${settingsTab==='encouragements'?(n?'bg-night-amber text-night-bg':'bg-white shadow-sm'):''}`}>鼓励话管理</button></div>
      {settingsTab==='tags'?<div className="space-y-4"><div><p className="text-xs font-medium mb-2">活动标签</p><div className="flex flex-wrap gap-2">{tags.map(tag=><span key={tag} className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs ${n?'bg-night-bg':'bg-day-bg'}`}>{tag}<button onClick={()=>setTags(tags.filter(x=>x!==tag))} disabled={tags.length<=1} className="opacity-50 hover:opacity-100 disabled:opacity-20"><X size={12}/></button></span>)}</div></div><div className="flex gap-2"><input value={tagDraft} onChange={e=>setTagDraft(e.target.value)} onKeyDown={e=>e.key==='Enter'&&addTag()} placeholder="添加一个标签" className={`no-frame flex-1 rounded-xl border px-3 py-2 text-sm ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/><button onClick={addTag} className={`px-4 rounded-xl ${n?'bg-night-amber text-night-bg':'bg-day-pink text-white'}`}><Plus size={16}/></button></div><button disabled={settingsBusy} onClick={saveTags} className={`w-full py-3 rounded-xl ${n?'bg-night-amber text-night-bg':'bg-day-pink text-white'}`}>{settingsBusy?'保存中…':'保存标签'}</button></div>:<div className="space-y-4"><div className={`rounded-2xl border p-4 ${n?'border-night-border bg-night-bg/40':'border-day-border bg-day-bg'}`}><p className="text-xs font-medium mb-3">{editingEnc?'编辑鼓励话':'添加鼓励话'}</p><textarea value={encDraft.text} onChange={e=>setEncDraft({...encDraft,text:e.target.value})} rows={3} placeholder="例如：慢一点也没关系，你正在靠近想去的地方。" className={`no-frame w-full resize-none rounded-xl border px-3 py-2 text-sm ${n?'bg-night-bg border-night-border':'bg-white border-day-border'}`}/><div className="flex gap-2 mt-3"><button onClick={()=>setEncDraft(v=>({...v,scope:'permanent'}))} className={`rounded-full border px-3 py-1.5 text-xs ${encDraft.scope==='permanent'?(n?'border-night-amber text-night-amber':'border-day-pink text-day-text'):''}`}>常驻</button><button onClick={()=>setEncDraft(v=>({...v,scope:'tags'}))} className={`rounded-full border px-3 py-1.5 text-xs ${encDraft.scope==='tags'?(n?'border-night-amber text-night-amber':'border-day-pink text-day-text'):''}`}>按标签</button></div>{encDraft.scope==='tags'&&<div className="flex flex-wrap gap-2 mt-3">{tags.map(tag=><button key={tag} onClick={()=>toggleEncTag(tag)} className={`rounded-full border px-3 py-1.5 text-xs ${encDraft.tags.includes(tag)?(n?'border-night-amber bg-night-amber/15 text-night-amber':'border-day-pink bg-day-pinkLight'):''}`}>{tag}</button>)}</div>}<div className="flex gap-2 mt-4"><button disabled={settingsBusy} onClick={saveEnc} className={`flex-1 py-2.5 rounded-xl ${n?'bg-night-amber text-night-bg':'bg-day-pink text-white'}`}>{settingsBusy?'保存中…':editingEnc?'保存修改':'添加鼓励话'}</button>{editingEnc&&<button onClick={()=>{setEditingEnc(null);setEncDraft({text:'',scope:'permanent',tags:[]})}} className={`px-3 rounded-xl border ${n?'border-night-border':'border-day-border'}`}><RotateCcw size={15}/></button>}</div></div><div className="space-y-2">{encouragements.map(x=><div key={x.id} className={`rounded-2xl border p-3 ${n?'border-night-border':'border-day-border'}`}><div className="flex gap-3 items-start"><div className="flex-1 text-sm leading-relaxed">{x.text}<div className="mt-2 text-[10px] opacity-45">{x.scope==='permanent'?'常驻':`#${(x.tags||[]).join(' #')}`} · {x.enabled?'启用':'已停用'}</div></div><button onClick={()=>toggleEnc(x)} title={x.enabled?'停用':'启用'} className={`p-1.5 ${x.enabled?'text-day-success':'opacity-40'}`}><Check size={14}/></button><button onClick={()=>editEnc(x)} className="p-1.5 opacity-50 hover:opacity-100"><Pencil size={14}/></button><button onClick={()=>deleteEnc(x.id)} className="p-1.5 text-day-error opacity-60 hover:opacity-100"><Trash2 size={14}/></button></div></div>)}</div></div>}
    </div></>}

    {editing&&<><div className="fixed inset-0 z-[80] bg-black/45" onClick={()=>setEditing(null)}/><div className={`fixed z-[81] inset-x-4 mx-auto top-[10dvh] max-w-lg rounded-3xl border p-5 max-h-[80dvh] overflow-y-auto ${n?'bg-night-surface border-night-border':'bg-white border-day-border'}`}><div className="flex justify-between mb-4"><h3 className="font-medium">编辑记录</h3><button onClick={()=>setEditing(null)}><X size={17}/></button></div><div className="space-y-3 text-xs"><label className="block">事情<input value={editing.title} onChange={e=>setEditing({...editing,title:e.target.value})} className={`no-frame mt-1 w-full rounded-xl border px-3 py-2 ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/></label><label className="block">标签<input value={editing.tags.join(', ')} onChange={e=>setEditing({...editing,tags:e.target.value.split(/[,，\s]+/).filter(Boolean)})} className={`no-frame mt-1 w-full rounded-xl border px-3 py-2 ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/></label><div className="grid grid-cols-2 gap-2"><label>开始<input type="datetime-local" value={formatMadridInput(editing.start_at)} onChange={e=>setEditing({...editing,start_at:e.target.value})} className={`no-frame mt-1 w-full rounded-xl border px-2 py-2 ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/></label><label>结束<input type="datetime-local" value={editing.end_at?formatMadridInput(editing.end_at):''} onChange={e=>setEditing({...editing,end_at:e.target.value||undefined})} className={`no-frame mt-1 w-full rounded-xl border px-2 py-2 ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/></label></div><label className="block">开始备注<textarea value={editing.note||''} onChange={e=>setEditing({...editing,note:e.target.value})} rows={3} className={`no-frame mt-1 w-full rounded-xl border px-3 py-2 ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/></label><label className="block">结束备注<textarea value={editing.end_note||''} onChange={e=>setEditing({...editing,end_note:e.target.value})} rows={3} className={`no-frame mt-1 w-full rounded-xl border px-3 py-2 ${n?'bg-night-bg border-night-border':'bg-day-bg border-day-border'}`}/></label><button onClick={saveEdit} className={`w-full py-3 rounded-xl flex justify-center items-center gap-2 ${n?'bg-night-amber text-night-bg':'bg-day-pink text-white'}`}><Save size={14}/>保存修改</button></div></div></>}
  </div>
}
