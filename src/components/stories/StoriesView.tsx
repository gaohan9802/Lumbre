'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Edit3, Heart, Pin, Plus, Trash2, X } from 'lucide-react'
import { stories as api } from '@/lib/api'
import { useTheme } from '@/lib/theme'
import { MarkdownText } from '@/components/chat/MarkdownText'
import { PaperActionDialog } from '@/components/PaperActionDialog'

type Shelf = 'moonlight' | 'undertow'
type Summary = {
  id: string; title: string; shelf: Shelf; status: 'draft' | 'complete'; favorite: boolean; pinned: boolean
  section_count: number; char_count: number; created_at: string; updated_at: string
}
type Story = Omit<Summary, 'section_count' | 'char_count'> & { sections: { id: string; text: string }[] }
const shelfName = (shelf: Shelf) => shelf === 'moonlight' ? '月灯' : '暗潮'
const date = (value: string) => new Date(value).toLocaleDateString('zh-CN', { timeZone: 'Europe/Madrid', year: 'numeric', month: 'long', day: 'numeric' })

export function StoriesView() {
  const night = useTheme(state => state.theme === 'night')
  const [shelf, setShelf] = useState<Shelf>('moonlight')
  const [favorites, setFavorites] = useState(false)
  const [list, setList] = useState<Summary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [story, setStory] = useState<Story | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: '', shelf: 'moonlight' as Shelf, text: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)

  const loadList = useCallback(async () => {
    try {
      const data = await api.list()
      const next = data.stories || []
      setList(next)
      setSelected(current => current && next.some((item: Summary) => item.id === current) ? current : null)
    } catch (cause: any) { setError(cause?.message || '故事集加载失败') }
  }, [])
  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => {
    if (!selected) { setStory(null); return }
    void api.get(selected).then(data => setStory(data.story)).catch(cause => setError(cause?.message || '故事加载失败'))
  }, [selected])
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void loadList() }
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [loadList])

  const shown = useMemo(() => list.filter(item => item.shelf === shelf && (!favorites || item.favorite)), [list, shelf, favorites])
  useEffect(() => { if (selected && !shown.some(item => item.id === selected)) setSelected(null) }, [shown, selected])
  const body = story?.sections.map(section => section.text).join('\n\n') || ''

  const act = async (action: string, data: Record<string, unknown>) => {
    setBusy(true); setError('')
    try {
      const result = await api.act(action, data)
      await loadList()
      if (result.story) setStory(result.story)
      return result
    } catch (cause: any) { setError(cause?.message || '操作失败'); return null }
    finally { setBusy(false) }
  }
  const create = async () => {
    const result = await act('create', { title: '未题故事', shelf })
    if (result?.story) { setSelected(result.story.id); setStory(result.story); openEdit(result.story) }
  }
  const openEdit = (value = story) => {
    if (!value) return
    setDraft({ title: value.title, shelf: value.shelf, text: value.sections.map(section => section.text).join('\n\n') })
    setEditing(true)
  }
  const save = async () => {
    if (!story || !draft.title.trim()) return
    await act('replace_body', { id: story.id, text: draft.text })
    await act('update', { id: story.id, patch: { title: draft.title, shelf: draft.shelf } })
    setShelf(draft.shelf); setEditing(false)
  }
  const remove = async () => {
    if (!story) return
    await act('delete', { id: story.id })
    setDeleteOpen(false); setSelected(null); setStory(null)
  }

  return (
    <div className={`h-full overflow-hidden ${night ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
      <div className="mx-auto flex h-full max-w-6xl flex-col px-4 py-5 sm:px-7">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-[10px] uppercase tracking-[.32em] opacity-45">stories by the bedside</p><h1 className="mt-1 font-serif text-2xl">枕边集</h1></div>
          <button onClick={create} disabled={busy} className={`rounded-full px-4 py-2 text-xs disabled:opacity-40 ${night ? 'bg-night-amber text-night-bg' : 'chat-dialog-accent'}`}><Plus className="mr-1 inline" size={14}/>新故事</button>
        </header>
        <div className="mb-4 flex items-center gap-2">
          {(['moonlight', 'undertow'] as Shelf[]).map(value => <button key={value} onClick={() => setShelf(value)} className={`rounded-full px-4 py-2 text-xs ${shelf === value ? (night ? 'bg-night-amber text-night-bg' : 'chat-dialog-accent') : 'bg-current/5'}`}>{value === 'moonlight' ? '☾ 月灯' : '◐ 暗潮'}</button>)}
          <button onClick={() => setFavorites(value => !value)} className={`ml-auto rounded-full px-3 py-2 text-xs ${favorites ? (night ? 'bg-night-amber text-night-bg' : 'chat-dialog-accent') : 'bg-current/5'}`}><Heart className="mr-1 inline" size={13} fill={favorites ? 'currentColor' : 'none'}/>收藏</button>
        </div>

        <aside className={`min-h-0 flex-1 overflow-y-auto rounded-3xl p-3 ${night ? 'bg-white/[.035]' : 'chat-dialog-card'}`}>
            <div className="space-y-2">{shown.map(item => <button key={item.id} onClick={() => setSelected(item.id)} className={`w-full rounded-2xl px-4 py-3 text-left transition ${selected === item.id ? night ? 'bg-night-amber/15' : 'bg-[#DBB9B3]/25' : 'hover:bg-current/5'}`}>
              <div className="flex items-start gap-2"><span className="min-w-0 flex-1 truncate font-serif text-sm">{item.pinned && '⌁ '}{item.title}</span>{item.favorite && <Heart size={11} fill="currentColor" className={`mt-1 ${night ? 'text-night-amber' : 'text-[#aa6271]'}`}/>}</div>
            </button>)}</div>
        </aside>
        {error && <p className="mt-2 text-center text-xs text-red-500">{error}</p>}
      </div>

      {story && selected && !editing && <div className="fixed inset-0 z-[115] grid place-items-center bg-black/55 p-4 backdrop-blur-sm"><button type="button" aria-label="返回枕边集" onClick={() => { setSelected(null); setStory(null) }} className="absolute inset-0"/><article className={`relative max-h-[88dvh] w-full max-w-3xl overflow-y-auto rounded-[28px] px-5 py-5 shadow-2xl sm:px-7 ${night ? 'border border-night-border bg-night-surface' : 'chat-dialog'}`}><div className="mb-4 flex items-start justify-between gap-3 border-b border-current/10 pb-3"><div><p className="text-[10px] tracking-[.24em] opacity-45">{shelfName(story.shelf)} · {story.status === 'draft' ? '写作中' : '已完成'}</p><h2 className="mt-1 font-serif text-xl leading-tight">{story.title}</h2><p className="mt-1 text-[10px] opacity-40">{date(story.created_at)} · {body.length.toLocaleString()} 字</p></div><div className="flex gap-1"><button aria-label="收藏" onClick={() => void act('update', { id: story.id, patch: { favorite: !story.favorite } })} className="rounded-full p-2 hover:bg-current/5"><Heart size={15} fill={story.favorite ? 'currentColor' : 'none'} className={story.favorite ? 'text-[#aa6271]' : ''}/></button><button aria-label="置顶" onClick={() => void act('update', { id: story.id, patch: { pinned: !story.pinned } })} className="rounded-full p-2 hover:bg-current/5"><Pin size={15} fill={story.pinned ? 'currentColor' : 'none'}/></button><button aria-label="编辑" onClick={() => openEdit()} className="rounded-full p-2 hover:bg-current/5"><Edit3 size={15}/></button><button aria-label="关闭" onClick={() => {setSelected(null);setStory(null)}} className="rounded-full p-2"><X size={16}/></button></div></div>{body && <div className="font-serif text-sm tracking-[.01em]"><MarkdownText content={body}/></div>}<footer className="mt-6 flex items-center justify-between border-t border-current/10 pt-4 text-xs"><button disabled={!body || busy} onClick={() => void act('update', { id: story.id, patch: { status: story.status === 'complete' ? 'draft' : 'complete' } })} className="opacity-60 disabled:opacity-20"><Check className="mr-1 inline" size={14}/>{story.status === 'complete' ? '改回写作中' : '标记完成'}</button><button className="text-red-500/70" onClick={() => setDeleteOpen(true)}><Trash2 className="mr-1 inline" size={14}/>删除</button></footer></article></div>}

      {editing && story && <div className="fixed inset-0 z-[120] grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
        <div className={`flex max-h-[92dvh] w-full max-w-3xl flex-col rounded-[28px] p-5 shadow-2xl ${night ? 'border border-night-border bg-night-surface' : 'chat-dialog'}`}>
          <div className="mb-4 flex items-center gap-3"><input value={draft.title} onChange={event => setDraft(value => ({ ...value, title: event.target.value }))} className="min-w-0 flex-1 bg-transparent font-serif text-2xl outline-none"/><button aria-label="关闭编辑" onClick={() => setEditing(false)}><X size={20}/></button></div>
          <div className="mb-3 flex gap-2">{(['moonlight', 'undertow'] as Shelf[]).map(value => <button key={value} onClick={() => setDraft(item => ({ ...item, shelf: value }))} className={`rounded-full px-3 py-1.5 text-xs ${draft.shelf === value ? (night ? 'bg-night-amber text-night-bg' : 'chat-dialog-accent') : 'bg-current/5'}`}>{shelfName(value)}</button>)}</div>
          <textarea value={draft.text} onChange={event => setDraft(value => ({ ...value, text: event.target.value }))} className={`min-h-0 flex-1 resize-none rounded-2xl border bg-transparent p-4 font-serif leading-8 outline-none ${night ? 'border-white/10' : 'chat-dialog-field'}`} rows={18}/>
          <button disabled={busy || !draft.title.trim()} onClick={save} className={`mt-4 rounded-2xl py-3 text-sm disabled:opacity-40 ${night ? 'bg-night-amber text-night-bg' : 'chat-dialog-accent'}`}>保存故事</button>
        </div>
      </div>}
      <PaperActionDialog open={deleteOpen} title="删除这篇故事？" confirmLabel="删除" danger busy={busy} onClose={() => setDeleteOpen(false)} onConfirm={remove}/>
    </div>
  )
}
