'use client'

import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, X } from 'lucide-react'
import { research as api } from '@/lib/api'
import { useTheme } from '@/lib/theme'

type Field = { id: string; name: string; description: string }
type Tag = { id: string; field_id: string; name: string }
type Topic = { id: string; field_id: string; title: string; summary: string; tag_ids: string[]; entry_count: number }
type Entry = { id: string; kind: 'thought' | 'question' | 'source' | 'finding'; title: string; content: string; source_title?: string; source_url?: string; created_at: string }
const kinds = { thought: ['✦', '想法'], question: ['◌', '问题'], source: ['⌁', '资料'], finding: ['◇', '发现'] } as const
const date = (value: string) => new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Europe/Madrid', month: 'long', day: 'numeric' })

export function ResearchView() {
  const night = useTheme(state => state.theme === 'night')
  const [fields, setFields] = useState<Field[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [topics, setTopics] = useState<Topic[]>([])
  const [fieldId, setFieldId] = useState<string | null>(null)
  const [topicId, setTopicId] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    void api.overview().then(data => {
      setFields(data.fields || []); setTags(data.tags || []); setTopics(data.topics || [])
      setFieldId((value: string | null) => value || data.fields?.[0]?.id || null)
    }).catch(cause => setError(cause?.message || '研究笔记加载失败'))
  }, [])
  const fieldTopics = useMemo(() => topics.filter(topic => topic.field_id === fieldId), [topics, fieldId])
  useEffect(() => { setTopicId(value => value && fieldTopics.some(topic => topic.id === value) ? value : null) }, [fieldTopics])
  useEffect(() => {
    if (!topicId) { setEntries([]); return }
    void api.topic(topicId).then(data => setEntries(data.entries || [])).catch(cause => setError(cause?.message || '课题加载失败'))
  }, [topicId])
  const topic = topics.find(item => item.id === topicId)
  const field = fields.find(item => item.id === fieldId)

  return <div className={`h-full overflow-y-auto md:overflow-hidden ${night ? 'bg-[#11171a] text-[#e9e5dc]' : 'chat-paper text-[#3f2c29]'}`}>
    <div className="mx-auto flex min-h-full max-w-7xl flex-col px-4 py-5 sm:px-7 md:h-full">
      <header className="mb-4 flex items-end justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.3em] opacity-40">field notes of a curious mind</p><h1 className="mt-1 font-serif text-3xl">星野手记</h1></div><span className="shrink-0 whitespace-nowrap rounded-full border border-current/10 px-3 py-1.5 text-[10px] opacity-55">只读 · 星星执笔</span></header>
      <div className="grid min-h-0 gap-3 md:flex-1 md:grid-cols-[minmax(150px,.7fr)_minmax(0,1.3fr)]">
        <aside className={`max-h-60 overflow-y-auto rounded-3xl p-3 md:max-h-none ${night ? 'bg-white/[.035]' : 'chat-dialog-card'}`}>
          <p className="mb-3 px-2 text-[10px] tracking-[.2em] opacity-40">领域</p>
          {!fields.length && <p className="py-12 text-center text-xs opacity-35">还没有种下第一片田野。</p>}
          <div className="space-y-2">{fields.map(item => <button key={item.id} onClick={() => setFieldId(item.id)} className={`w-full rounded-2xl px-3 py-3 text-left ${fieldId === item.id ? night ? 'bg-[#32444b]' : 'bg-[#DBB9B3]/25' : 'hover:bg-current/5'}`}><span className="font-serif text-sm">{item.name}</span><p className="mt-1 line-clamp-2 text-[10px] leading-4 opacity-45">{item.description || '尚未写下领域说明'}</p></button>)}</div>
        </aside>
        <aside className={`max-h-72 overflow-y-auto rounded-3xl p-3 md:max-h-none ${night ? 'bg-white/[.035]' : 'chat-dialog-card'}`}>
          <div className="mb-3 px-2"><p className="text-[10px] tracking-[.2em] opacity-40">{field?.name || '课题'}</p>{field && <div className="mt-2 flex flex-wrap gap-1">{tags.filter(tag => tag.field_id === field.id).map(tag => <span key={tag.id} className="rounded-full bg-current/5 px-2 py-1 text-[9px] opacity-60">#{tag.name}</span>)}</div>}</div>
          {!fieldTopics.length && <p className="py-12 text-center text-xs opacity-35">这里还没有课题。</p>}
          <div className="space-y-2">{fieldTopics.map(item => <button key={item.id} onClick={() => setTopicId(item.id)} className={`w-full rounded-2xl px-4 py-3 text-left ${topicId === item.id ? night ? 'bg-[#3a323f]' : 'bg-[#DBB9B3]/25' : 'hover:bg-current/5'}`}><p className="font-serif text-sm leading-5">{item.title}</p></button>)}</div>
        </aside>
      </div>
      {error && <p className="mt-2 text-center text-xs text-red-500">{error}</p>}
    </div>
    {topic && <div className="fixed inset-0 z-[115] grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={()=>setTopicId(null)}><article onClick={event=>event.stopPropagation()} className={`max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-[28px] p-5 shadow-2xl sm:p-7 ${night ? 'bg-[#192025]' : 'chat-dialog'}`}><div className="mb-4 flex items-start justify-between gap-3 border-b border-current/10 pb-3"><div><h2 className="font-serif text-xl leading-tight">{topic.title}</h2>{topic.summary&&<p className="mt-2 text-sm leading-5 opacity-60">{topic.summary}</p>}<div className="mt-2 flex flex-wrap gap-1">{tags.filter(tag=>topic.tag_ids.includes(tag.id)).map(tag=><span key={tag.id} className="rounded-full bg-current/5 px-2 py-1 text-[9px] opacity-55">#{tag.name}</span>)}</div></div><button aria-label="关闭" onClick={()=>setTopicId(null)} className="p-2 opacity-55"><X size={17}/></button></div>{!entries.length&&<p className="py-16 text-center text-xs opacity-35">星星还在这片空白里观察。</p>}<div className="space-y-5">{entries.map(entry=>{const [,label]=kinds[entry.kind]||kinds.thought;return <section key={entry.id}><div className="mb-1 flex items-center gap-2 text-[10px] opacity-45"><span>{label}</span><span>·</span><span>{date(entry.created_at)}</span></div>{entry.title&&<h3 className="mb-1 font-serif text-base">{entry.title}</h3>}<p className="whitespace-pre-wrap text-justify text-sm leading-6">{entry.content}</p>{entry.source_url&&<a href={entry.source_url} target="_blank" rel="noreferrer" className={`mt-2 inline-flex items-center gap-1 text-xs underline decoration-current/30 underline-offset-4 ${night?'text-[#708e91]':'text-[#9c6e69]'}`}>{entry.source_title||'打开资料来源'}<ExternalLink size={11}/></a>}</section>})}</div></article></div>}
  </div>
}
