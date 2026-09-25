'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Clock3, Edit3, Feather, MessageCircle, Plus, Send, Trash2 } from 'lucide-react'
import { poems as api } from '@/lib/api'
import { shareToChat } from '@/lib/share'
import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'

type Author = 'fire' | 'star'
type Version = { text: string; actor: Author; at: string }
type Line = { id: string; author: Author; versions: Version[]; deleted_at?: string }
type Poem = { id: string; title: string; lines: Line[]; turn: Author; archived: boolean; created_at: string; updated_at: string }

const who = (author: Author) => author === 'fire' ? '小火' : '星星'
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Europe/Madrid', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export function PoemsView() {
  const { currentUser } = useApp()
  const { theme } = useTheme()
  const night = theme === 'night'
  const [poems, setPoems] = useState<Poem[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api.list(showArchived)
      setPoems(data.poems || [])
      setSelected(id => id && data.poems?.some((poem: Poem) => poem.id === id) ? id : data.poems?.[0]?.id || null)
    } catch (cause: any) { setError(cause?.message || '共诗加载失败') }
  }, [showArchived])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void load() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [load])

  const poem = useMemo(() => poems.find(item => item.id === selected) || null, [poems, selected])
  const activeLines = poem?.lines.filter(line => !line.deleted_at) || []
  const text = activeLines.map(line => line.versions.at(-1)?.text || '').join('\n')

  const act = async (action: string, data: Record<string, unknown>) => {
    setBusy(true); setError('')
    try { await api.act(action, { actor: currentUser, ...data }); await load(); return true }
    catch (cause: any) { setError(cause?.message || '操作失败'); return false }
    finally { setBusy(false) }
  }

  const create = async () => {
    const title = window.prompt('给这首诗起个名字（可以留空）', '')
    if (title === null) return
    setBusy(true)
    try {
      const data = await api.act('create', { title })
      await load(); setSelected(data.poem.id)
    } catch (cause: any) { setError(cause?.message || '新建失败') }
    finally { setBusy(false) }
  }

  const append = async () => {
    if (!poem || !draft.trim()) return
    if (await act('append', { id: poem.id, text: draft })) setDraft('')
  }

  const share = (askStar: boolean) => {
    if (!poem) return
    shareToChat({
      kind: 'poem', title: `共诗 · ${poem.title}`,
      subtitle: `${activeLines.length} 句 · 现在轮到${who(poem.turn)}`,
      body: `${text || '（还是一张空白诗笺）'}${askStar ? '\n\n请先用 read_poems 读取这首诗，再用 write_poem 续写一句。' : ''}`,
      metadata: { poemId: poem.id, updatedAt: poem.updated_at, lineCount: activeLines.length, turn: poem.turn, requestContinuation: askStar },
    })
  }

  if (!poem) return (
    <div className={`h-full overflow-y-auto px-6 py-10 ${night ? 'bg-[#171512] text-[#eee5d8]' : 'chat-paper text-[#3f2c29]'}`}>
      <div className="mx-auto max-w-2xl text-center"><Feather className="mx-auto mb-4 opacity-50" /><h1 className="font-serif text-3xl">共诗</h1><p className="mt-2 text-sm opacity-60">你一句，我一句。</p><button disabled={busy} onClick={create} className={`mt-8 rounded-full px-5 py-2.5 text-sm ${night ? 'bg-[#9d5361] text-white' : 'chat-dialog-accent'}`}><Plus className="mr-1 inline" size={15}/>新建一首诗</button>{error && <p className="mt-4 text-sm text-red-500">{error}</p>}</div>
    </div>
  )

  return (
    <div className={`h-full overflow-y-auto ${night ? 'bg-[#171512] text-[#eee5d8]' : 'chat-paper text-[#3f2c29]'}`}>
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
        <div className="mb-5 flex items-center gap-2 overflow-x-auto pb-2">
          {poems.map(item => <button key={item.id} onClick={() => setSelected(item.id)} className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${item.id === poem.id ? (night ? 'bg-[#9d5361] text-white' : 'chat-dialog-accent') : night ? 'bg-white/5' : 'bg-[#DBB9B3]/15'}`}>{item.archived ? '📦 ' : ''}{item.title}</button>)}
          <button aria-label="新建一首诗" onClick={create} className={`shrink-0 rounded-full p-2 ${night ? 'bg-white/5' : 'bg-[#DBB9B3]/15'}`}><Plus size={14}/></button>
          <button onClick={() => setShowArchived(value => !value)} className="ml-auto shrink-0 px-2 text-[10px] opacity-50">{showArchived ? '收起归档' : '查看归档'}</button>
        </div>

        <article className={`relative overflow-hidden rounded-[28px] border px-5 py-8 shadow-sm sm:px-10 ${night ? 'border-white/10 bg-[#211e1a]' : 'chat-dialog-card'}`}>
          <div className="pointer-events-none absolute inset-y-0 left-8 w-px bg-[#b86673]/15" />
          <div className="relative mb-8 flex items-start justify-between gap-3">
            <div><button onClick={async () => { const title = window.prompt('诗题', poem.title); if (title !== null) await act('rename', { id: poem.id, title }) }} className="group flex items-center gap-2 text-left"><h1 className="font-serif text-3xl tracking-wide">{poem.title}</h1><Edit3 size={14} className="opacity-0 transition group-hover:opacity-40"/></button><p className="mt-1 text-xs opacity-45">始于 {time(poem.created_at)}</p></div>
            <button onClick={() => share(false)} className="rounded-full border border-current/15 px-3 py-2 text-xs"><Send className="mr-1 inline" size={13}/>发到聊天</button>
          </div>

          <div className="relative min-h-40 space-y-5">
            {activeLines.length === 0 && <p className="py-10 text-center font-serif text-lg opacity-35">空白也在等第一句话。</p>}
            {activeLines.map((line, index) => {
              const latest = line.versions.at(-1)!
              return <div key={line.id} className={`group flex gap-3 ${line.author === 'star' ? 'pl-5 sm:pl-10' : ''}`}>
                <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${line.author === 'fire' ? 'bg-[#a73a32]/70' : 'bg-[#DBB9B3]'}`}/>
                <div className="min-w-0 flex-1">
                  <p className="whitespace-pre-wrap font-serif text-lg leading-8">{latest.text}</p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] opacity-40"><span>{who(line.author)} · {time(latest.at)}</span>{line.versions.length > 1 && <details><summary className="cursor-pointer list-none"><Clock3 className="inline" size={11}/> {line.versions.length} 个版本</summary><div className={`absolute z-10 mt-1 max-w-xs rounded-xl p-3 shadow-xl ${night ? 'bg-[#312b25]' : 'chat-dialog'}`}>{line.versions.map((version, versionIndex) => <p key={version.at} className="mb-2 text-xs"><b>v{versionIndex + 1}</b> · {time(version.at)}<br/>{version.text}</p>)}</div></details>}</div>
                </div>
                {line.author === currentUser && <div className="flex opacity-30 transition group-hover:opacity-100"><button aria-label={`编辑第 ${index + 1} 句`} onClick={async () => { const next = window.prompt('修改这句', latest.text); if (next !== null) await act('edit_line', { id: poem.id, line_id: line.id, text: next }) }} className="p-1"><Edit3 size={13}/></button><button aria-label={`删除第 ${index + 1} 句`} onClick={async () => { if (window.confirm('删除这句？编辑历史会保留。')) await act('delete_line', { id: poem.id, line_id: line.id }) }} className="p-1 text-red-500"><Trash2 size={13}/></button></div>}
              </div>
            })}
          </div>

          <div className="relative mt-10 border-t border-current/10 pt-5">
            {poem.archived ? <button onClick={() => void act('archive', { id: poem.id, archived: false })} className="w-full rounded-2xl border border-current/15 px-4 py-3 text-sm">把它放回诗笺</button> : poem.turn === currentUser ? <div className="flex gap-2"><textarea value={draft} onChange={event => setDraft(event.target.value)} rows={2} placeholder="写下一句……" className={`min-w-0 flex-1 resize-none rounded-2xl border bg-transparent px-4 py-3 font-serif outline-none ${night ? 'border-white/10' : 'chat-dialog-field'}`}/><button disabled={busy || !draft.trim()} onClick={append} className={`rounded-2xl px-4 disabled:opacity-30 ${night ? 'bg-[#9d5361] text-white' : 'chat-dialog-accent'}`}><Feather size={18}/></button></div> : <button onClick={() => share(true)} className={`w-full rounded-2xl px-4 py-3 text-sm ${night ? 'bg-[#9d5361] text-white' : 'chat-dialog-accent'}`}><MessageCircle className="mr-2 inline" size={16}/>叫星星接一句</button>}
            {!poem.archived && <p className="mt-2 text-center text-xs opacity-45">现在轮到 {who(poem.turn)}</p>}
          </div>

          <details className="relative mt-6 border-t border-current/10 pt-4 text-xs opacity-60">
            <summary className="cursor-pointer list-none"><Clock3 className="mr-1 inline" size={13}/>创作痕迹 · {poem.lines.reduce((total, line) => total + line.versions.length + (line.deleted_at ? 1 : 0), 1)} 次</summary>
            <div className="mt-3 space-y-2 pl-4">
              <p>{time(poem.created_at)} · 新建《{poem.title}》</p>
              {poem.lines.flatMap((line, lineIndex) => [
                ...line.versions.map((version, versionIndex) => <p key={`${line.id}-${version.at}`}>{time(version.at)} · {who(version.actor)} {versionIndex ? '修改' : '写下'}第 {lineIndex + 1} 句：{version.text}</p>),
                ...(line.deleted_at ? [<p key={`${line.id}-deleted`}>{time(line.deleted_at)} · {who(line.author)} 删除第 {lineIndex + 1} 句</p>] : []),
              ])}
            </div>
          </details>
        </article>
        <div className="mt-4 flex justify-between text-xs opacity-55">{!poem.archived ? <button onClick={() => void act('archive', { id: poem.id, archived: true })}><Archive className="mr-1 inline" size={13}/>归档</button> : <span/>}<button className="text-red-500" onClick={async () => { if (window.confirm('永久删除整首诗？')) await act('delete', { id: poem.id }) }}><Trash2 className="mr-1 inline" size={13}/>删除</button></div>
        {error && <p className="mt-4 text-center text-sm text-red-500">{error}</p>}
      </div>
    </div>
  )
}
