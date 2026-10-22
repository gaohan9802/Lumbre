'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Pencil, Plus, Search, Share2, Trash2, X } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { shareToChat } from '@/lib/share'
import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import type { FireDictionaryEntry } from '@/server/fire-dictionary-store'

const LETTERS = ['全部', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), '#']
const emptyDraft = { word: '', pinyin: '', definition: '', phrases: '', examples: '' }

export function FireDictionaryView() {
  const { currentUser } = useApp()
  const night = useTheme(state => state.theme === 'night')
  const [entries, setEntries] = useState<FireDictionaryEntry[]>([])
  const [query, setQuery] = useState('')
  const [letter, setLetter] = useState('全部')
  const [selected, setSelected] = useState<FireDictionaryEntry | null>(null)
  const [editing, setEditing] = useState<FireDictionaryEntry | 'new' | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [deleteTarget, setDeleteTarget] = useState<FireDictionaryEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (letter !== '全部') params.set('letter', letter)
      const data = await apiRequest(`/api/fire-dictionary?${params}`)
      setEntries(data.entries || [])
      setSelected(current => current ? (data.entries || []).find((entry: FireDictionaryEntry) => entry.id === current.id) || null : null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '辞典暂时翻不开') }
    finally { setLoading(false) }
  }, [letter, query])

  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer) }, [load])

  const groups = useMemo(() => entries.reduce<Record<string, FireDictionaryEntry[]>>((result, entry) => {
    ;(result[entry.letter] ||= []).push(entry)
    return result
  }, {}), [entries])

  const openEditor = (entry?: FireDictionaryEntry) => {
    setError('')
    setEditing(entry || 'new')
    setDraft(entry ? {
      word: entry.word,
      pinyin: entry.pinyin,
      definition: entry.definition,
      phrases: entry.phrases.join('、'),
      examples: entry.examples.map(example => example.content).join('\n'),
    } : emptyDraft)
  }

  const save = async () => {
    setBusy(true); setError('')
    try {
      const entry = {
        word: draft.word,
        pinyin: draft.pinyin,
        definition: draft.definition,
        phrases: draft.phrases.split(/[、,，\n]/).map(value => value.trim()).filter(Boolean),
        examples: draft.examples.split('\n').map(value => value.trim()).filter(Boolean),
      }
      const data = await apiRequest('/api/fire-dictionary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editing === 'new'
          ? { action: 'create', actor: currentUser, entry }
          : { action: 'update', actor: currentUser, id: editing?.id, patch: entry }),
      })
      setEditing(null); setSelected(data.entry); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '没能保存') }
    finally { setBusy(false) }
  }

  const remove = async () => {
    if (!deleteTarget) return
    setBusy(true); setError('')
    try {
      await apiRequest('/api/fire-dictionary', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', actor: currentUser, id: deleteTarget.id }) })
      setDeleteTarget(null); setSelected(null); await load()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '没能删除') }
    finally { setBusy(false) }
  }

  const share = (entry: FireDictionaryEntry) => {
    shareToChat({
      kind: 'fire-dictionary', title: `📖 ${entry.word}`, subtitle: `${entry.pinyin} · 小火辞典`,
      body: [`【小火释义】${entry.definition}`, entry.phrases.length ? `【组词】${entry.phrases.join('、')}` : '', `【例句】\n${entry.examples.map(example => `· ${example.content}`).join('\n')}`].filter(Boolean).join('\n\n'),
      metadata: { entry_id: entry.id, word: entry.word },
    })
  }

  const panel = night ? 'border-white/10 bg-white/[.035]' : 'border-[#ddd7cf] bg-[#fffdf9]'
  const field = night ? 'border-white/10 bg-white/[.04]' : 'border-[#ddd7cf] bg-white/75'
  const muted = night ? 'text-white/45' : 'text-[#7d7770]'
  const accent = night ? 'bg-night-amber text-night-bg' : 'chat-dialog-accent'

  if (editing) return <div className="h-full overflow-y-auto px-5 pb-8">
    <div className="sticky top-0 z-10 flex items-center gap-3 bg-inherit py-3"><button aria-label="返回" onClick={() => setEditing(null)}><ArrowLeft size={18}/></button><h2 className="flex-1 font-serif text-lg">{editing === 'new' ? '收进一个新词' : '重新解释这个词'}</h2></div>
    <div className="mx-auto max-w-2xl space-y-4 pt-2">
      {([['词语', 'word', '比如：窝里横'], ['拼音', 'pinyin', 'wō lǐ hèng'], ['小火释义', 'definition', '这个词在小火这里是什么意思……']] as const).map(([label, key, placeholder]) => <label key={key} className="block space-y-1.5 text-sm"><span>{label}</span>{key === 'definition' ? <textarea rows={5} value={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} className={`w-full resize-none rounded-2xl border px-4 py-3 outline-none ${field}`}/> : <input value={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} placeholder={placeholder} className={`w-full rounded-2xl border px-4 py-3 outline-none ${field}`}/>}</label>)}
      <label className="block space-y-1.5 text-sm"><span>组词 <span className={muted}>· 用顿号或逗号分开</span></span><textarea rows={3} value={draft.phrases} onChange={event => setDraft(current => ({ ...current, phrases: event.target.value }))} className={`w-full resize-none rounded-2xl border px-4 py-3 outline-none ${field}`}/></label>
      <label className="block space-y-1.5 text-sm"><span>例句 <span className={muted}>· 每行一句，至少一句</span></span><textarea rows={6} value={draft.examples} onChange={event => setDraft(current => ({ ...current, examples: event.target.value }))} className={`w-full resize-none rounded-2xl border px-4 py-3 outline-none ${field}`}/></label>
      {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
      <button disabled={busy} onClick={() => void save()} className={`w-full rounded-2xl py-3 text-sm font-medium disabled:opacity-40 ${accent}`}>保存词条</button>
    </div>
  </div>

  if (selected) return <div className="h-full overflow-y-auto px-5 pb-8">
    <div className="sticky top-0 z-10 flex items-center gap-3 bg-inherit py-3"><button aria-label="返回词典" onClick={() => setSelected(null)}><ArrowLeft size={18}/></button><span className={`flex-1 text-xs tracking-[.18em] ${muted}`}>小火辞典 · {selected.letter}</span><button aria-label="分享到 Chat" onClick={() => share(selected)} className="p-2"><Share2 size={15}/></button><button aria-label="编辑" onClick={() => openEditor(selected)} className="p-2"><Pencil size={15}/></button><button aria-label="删除" onClick={() => setDeleteTarget(selected)} className="p-2 text-red-500"><Trash2 size={15}/></button></div>
    <article className="mx-auto max-w-2xl pt-8">
      <h1 className="font-serif text-4xl">{selected.word}</h1><p className={`mt-2 text-sm ${muted}`}>{selected.pinyin}</p>
      <section className="mt-10"><div className={`mb-2 text-[10px] tracking-[.2em] ${muted}`}>小火释义</div><p className="whitespace-pre-wrap font-serif text-lg leading-8">{selected.definition}</p></section>
      {!!selected.phrases.length && <section className="mt-8"><div className={`mb-3 text-[10px] tracking-[.2em] ${muted}`}>组词</div><div className="flex flex-wrap gap-2">{selected.phrases.map(phrase => <span key={phrase} className={`rounded-full border px-3 py-1 text-sm ${panel}`}>{phrase}</span>)}</div></section>}
      <section className="mt-8"><div className={`mb-3 text-[10px] tracking-[.2em] ${muted}`}>例句</div><div className="space-y-3">{selected.examples.map(example => <blockquote key={example.id} className={`border-l-2 pl-4 font-serif leading-7 ${night ? 'border-night-amber/45' : 'border-[#d7aaa2]'}`}>{example.content}<span className={`ml-2 text-[10px] ${muted}`}>{example.author === 'star' ? '🐆' : '🦦'}</span></blockquote>)}</div></section>
      <p className={`mt-10 text-[10px] ${muted}`}>最后整理 · {selected.updated_by === 'star' ? '🐆' : '🦦'} · {new Date(selected.updated_at).toLocaleDateString('zh-CN')}</p>
    </article>
    {deleteTarget && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/35 p-6"><div role="alertdialog" aria-modal="true" className={`w-full max-w-sm rounded-3xl border p-5 shadow-2xl ${panel}`}><h2 className="font-medium">彻底删除「{deleteTarget.word}」？</h2><p className={`mt-2 text-sm ${muted}`}>删除后不会在辞典里留下占位。</p><div className="mt-6 flex justify-end gap-3"><button onClick={() => setDeleteTarget(null)} className="px-4 py-2 text-sm">取消</button><button disabled={busy} onClick={() => void remove()} className="rounded-xl bg-red-600 px-4 py-2 text-sm text-white">删除</button></div></div></div>}
  </div>

  return <div className="flex h-full flex-col overflow-hidden px-4 pb-4">
    <header className="flex items-center gap-3 px-1 pb-3"><div className="flex-1"><h1 className="font-serif text-xl">小火辞典</h1><p className={`text-xs ${muted}`}>{entries.length ? `${entries.length} 个小火词` : '从第一个只有小火才这样解释的词开始'}</p></div><button aria-label="新增词条" onClick={() => openEditor()} className={`rounded-full p-2.5 ${accent}`}><Plus size={17}/></button></header>
    <label className={`flex items-center gap-2 rounded-2xl border px-3 ${field}`}><Search size={15} className={muted}/><input aria-label="搜索小火辞典" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜词、释义、词组或例句" className="min-w-0 flex-1 bg-transparent py-2.5 text-sm outline-none"/>{query && <button aria-label="清空搜索" onClick={() => setQuery('')}><X size={14}/></button>}</label>
    <div className="my-3 flex shrink-0 gap-1 overflow-x-auto pb-1">{LETTERS.map(item => <button key={item} onClick={() => setLetter(item)} className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${letter === item ? accent : muted}`}>{item}</button>)}</div>
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">{error && <p role="alert" className="py-3 text-sm text-red-500">{error}</p>}{loading ? <p className={`py-16 text-center text-sm ${muted}`}>翻辞典中……</p> : entries.length ? Object.entries(groups).map(([group, items]) => <section key={group} className="mb-5"><h2 className={`sticky top-0 py-1 text-xs font-medium ${muted}`}>{group}</h2><div className={`overflow-hidden rounded-2xl border ${panel}`}>{items.map(entry => <button key={entry.id} onClick={() => setSelected(entry)} className="flex w-full items-center gap-3 border-b border-current/10 px-4 py-3 text-left last:border-0"><div className="min-w-0 flex-1"><div className="font-serif text-lg">{entry.word}</div><div className={`truncate text-xs ${muted}`}>{entry.pinyin} · {entry.definition}</div></div><span className={`text-xs ${muted}`}>›</span></button>)}</div></section>) : <p className={`py-16 text-center text-sm ${muted}`}>{query || letter !== '全部' ? '这一页还没有找到词。' : '第一页还是空白的。'}</p>}</div>
  </div>
}
