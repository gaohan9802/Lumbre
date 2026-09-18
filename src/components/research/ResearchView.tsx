'use client'

import { useEffect, useMemo, useState } from 'react'
import { BookMarked, ExternalLink, Sparkles } from 'lucide-react'
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
  useEffect(() => { setTopicId(value => value && fieldTopics.some(topic => topic.id === value) ? value : fieldTopics[0]?.id || null) }, [fieldTopics])
  useEffect(() => {
    if (!topicId) { setEntries([]); return }
    void api.topic(topicId).then(data => setEntries(data.entries || [])).catch(cause => setError(cause?.message || '课题加载失败'))
  }, [topicId])
  const topic = topics.find(item => item.id === topicId)
  const field = fields.find(item => item.id === fieldId)

  return <div className={`h-full overflow-y-auto md:overflow-hidden ${night ? 'bg-[#11171a] text-[#e9e5dc]' : 'bg-[#eef0eb] text-[#3f4945]'}`}>
    <div className="mx-auto flex min-h-full max-w-7xl flex-col px-4 py-5 sm:px-7 md:h-full">
      <header className="mb-4 flex items-end justify-between gap-3"><div><p className="text-[10px] uppercase tracking-[.3em] opacity-40">field notes of a curious mind</p><h1 className="mt-1 font-serif text-3xl">星野手记</h1></div><span className="shrink-0 whitespace-nowrap rounded-full border border-current/10 px-3 py-1.5 text-[10px] opacity-55">只读 · 星星执笔</span></header>
      <div className="grid min-h-0 gap-3 md:flex-1 md:grid-cols-[190px_260px_minmax(0,1fr)]">
        <aside className={`max-h-60 overflow-y-auto rounded-3xl p-3 md:max-h-none ${night ? 'bg-white/[.035]' : 'bg-white/55'}`}>
          <p className="mb-3 px-2 text-[10px] tracking-[.2em] opacity-40">领域</p>
          {!fields.length && <p className="py-12 text-center text-xs opacity-35">还没有种下第一片田野。</p>}
          <div className="space-y-2">{fields.map(item => <button key={item.id} onClick={() => setFieldId(item.id)} className={`w-full rounded-2xl px-3 py-3 text-left ${fieldId === item.id ? night ? 'bg-[#32444b]' : 'bg-white shadow-sm' : 'hover:bg-current/5'}`}><span className="font-serif text-sm">{item.name}</span><p className="mt-1 line-clamp-2 text-[10px] leading-4 opacity-45">{item.description || '尚未写下领域说明'}</p></button>)}</div>
        </aside>
        <aside className={`max-h-72 overflow-y-auto rounded-3xl p-3 md:max-h-none ${night ? 'bg-white/[.035]' : 'bg-white/55'}`}>
          <div className="mb-3 px-2"><p className="text-[10px] tracking-[.2em] opacity-40">{field?.name || '课题'}</p>{field && <div className="mt-2 flex flex-wrap gap-1">{tags.filter(tag => tag.field_id === field.id).map(tag => <span key={tag.id} className="rounded-full bg-current/5 px-2 py-1 text-[9px] opacity-60">#{tag.name}</span>)}</div>}</div>
          {!fieldTopics.length && <p className="py-12 text-center text-xs opacity-35">这里还没有课题。</p>}
          <div className="space-y-2">{fieldTopics.map(item => <button key={item.id} onClick={() => setTopicId(item.id)} className={`w-full rounded-2xl px-4 py-3 text-left ${topicId === item.id ? night ? 'bg-[#3a323f]' : 'bg-[#fffaf3] shadow-sm' : 'hover:bg-current/5'}`}><p className="font-serif text-sm leading-5">{item.title}</p><p className="mt-1 text-[10px] opacity-40">{item.entry_count} 条观察</p></button>)}</div>
        </aside>
        <main className={`min-h-[50vh] overflow-y-auto rounded-[30px] border px-5 py-7 sm:px-9 md:min-h-0 ${night ? 'border-white/10 bg-[#192025]' : 'border-[#d8ddd5] bg-[#fbfcf8]'}`}>
          {!topic ? <div className="grid h-full place-items-center text-center opacity-30"><div><BookMarked className="mx-auto mb-3"/><p>从一片田野里打开一个课题。</p></div></div> : <div className="mx-auto max-w-2xl">
            <div className="mb-8 border-b border-current/10 pb-5"><Sparkles size={16} className="mb-3 opacity-45"/><h2 className="font-serif text-2xl leading-tight">{topic.title}</h2>{topic.summary && <p className="mt-3 text-sm leading-6 opacity-60">{topic.summary}</p>}<div className="mt-3 flex flex-wrap gap-1">{tags.filter(tag => topic.tag_ids.includes(tag.id)).map(tag => <span key={tag.id} className="rounded-full bg-current/5 px-2 py-1 text-[9px] opacity-55">#{tag.name}</span>)}</div></div>
            {!entries.length && <p className="py-20 text-center text-xs opacity-35">星星还在这片空白里观察。</p>}
            <div className="relative space-y-7 before:absolute before:bottom-0 before:left-[7px] before:top-2 before:w-px before:bg-current/10">{entries.map(entry => { const [icon, label] = kinds[entry.kind] || kinds.thought; return <article key={entry.id} className="relative pl-8"><span className={`absolute left-0 top-1 grid h-[15px] w-[15px] place-items-center rounded-full text-[11px] ${night ? 'bg-[#28343a]' : 'bg-[#e7ebe4]'}`}>{icon}</span><div className="mb-2 flex items-center gap-2 text-[10px] opacity-45"><span>{label}</span><span>·</span><span>{date(entry.created_at)}</span></div>{entry.title && <h3 className="mb-2 font-serif text-lg">{entry.title}</h3>}<p className="whitespace-pre-wrap text-sm leading-7">{entry.content}</p>{entry.source_url && <a href={entry.source_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-[#708e91] underline decoration-current/30 underline-offset-4">{entry.source_title || '打开资料来源'}<ExternalLink size={11}/></a>}</article>})}</div>
          </div>}
        </main>
      </div>
      {error && <p className="mt-2 text-center text-xs text-red-500">{error}</p>}
    </div>
  </div>
}
