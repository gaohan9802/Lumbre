'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, ChevronLeft, ChevronRight, List, MessageCircle, Pencil, Send, Settings2, Share2, Trash2, WifiOff, X } from 'lucide-react'
import { mediaLibrary as api } from '@/lib/api'
import {
  flushOfflineCoreadProgress, getOfflineCoreadBook, newestCoreadProgress, readLocalCoreadProgress,
  saveLocalCoreadProgress, type OfflineCoreadBook,
} from '@/lib/coread-offline'
import type { CoreadAnnotation, CoreadChapter, CoreadParagraph, CoreadProgress } from '@/lib/coread'
import type { MediaActor, MediaWork } from '@/lib/media-library'
import { shareToChat } from '@/lib/share'

type Slice = {
  book: { file_name: string; format: string; chapters: CoreadChapter[]; paragraph_count: number }
  paragraphs: CoreadParagraph[]
  progress: Partial<Record<MediaActor, CoreadProgress>>
  annotations: CoreadAnnotation[]
  next: number | null
  previous: number | null
}

type ReaderSettings = {
  family: 'serif' | 'sans'
  tone: 'paper' | 'soft' | 'night'
  fontSize: number
  lineHeight: number
  width: 'narrow' | 'medium' | 'wide'
}

const SETTINGS_KEY = 'lumbre-coread-reader-settings'
const person = (actor: MediaActor) => actor === 'fire' ? '小火' : '星星'
const icon = (actor: MediaActor) => actor === 'fire' ? '🦦' : '🐆'
const percent = (progress: CoreadProgress | undefined, total: number) => progress && total > 1 ? Math.round(progress.paragraph_idx / (total - 1) * 100) : 0
const defaultSettings = (night: boolean): ReaderSettings => ({ family: 'serif', tone: night ? 'night' : 'paper', fontSize: 18, lineHeight: 2, width: 'medium' })

function loadSettings(night: boolean): ReaderSettings {
  if (typeof window === 'undefined') return defaultSettings(night)
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return {
      family: stored.family === 'sans' ? 'sans' : 'serif',
      tone: ['paper', 'soft', 'night'].includes(stored.tone) ? stored.tone : night ? 'night' : 'paper',
      fontSize: Math.max(15, Math.min(24, Number(stored.fontSize) || 18)),
      lineHeight: [1.7, 2, 2.25].includes(Number(stored.lineHeight)) ? Number(stored.lineHeight) : 2,
      width: ['narrow', 'medium', 'wide'].includes(stored.width) ? stored.width : 'medium',
    }
  } catch { return defaultSettings(night) }
}

function offlineSlice(record: OfflineCoreadBook, actor: MediaActor, params: { start?: number; chapter_id?: string } = {}, local?: CoreadProgress): Slice {
  const chapter = params.chapter_id ? record.book.chapters.find(item => item.id === params.chapter_id) : undefined
  const fallback = newestCoreadProgress(local, record.progress[actor])?.paragraph_idx
  const start = Math.max(0, Math.min(record.book.paragraphs.length - 1, Number.isInteger(params.start) ? Number(params.start) : chapter?.start_idx ?? fallback ?? 0))
  const limit = 40
  const paragraphs = record.book.paragraphs.slice(start, start + limit)
  const end = paragraphs.at(-1)?.idx ?? start
  return {
    book: { file_name: record.book.file_name, format: record.book.format, chapters: record.book.chapters, paragraph_count: record.book.paragraphs.length },
    paragraphs,
    progress: { ...record.progress, [actor]: newestCoreadProgress(local, record.progress[actor]) },
    annotations: record.annotations.filter(item => item.paragraph_idx >= start && item.paragraph_idx <= end),
    next: end + 1 < record.book.paragraphs.length ? end + 1 : null,
    previous: start > 0 ? Math.max(0, start - limit) : null,
  }
}

export function CoreadReader({ work, actor, night, onClose, onChanged }: { work: MediaWork; actor: MediaActor; night: boolean; onClose: () => void; onChanged: () => void }) {
  const [slice, setSlice] = useState<Slice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<{ paragraph_idx: number; start_offset: number; end_offset: number; text: string } | null>(null)
  const [reply, setReply] = useState<CoreadAnnotation | null>(null)
  const [editing, setEditing] = useState<CoreadAnnotation | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [offline, setOffline] = useState(false)
  const [syncLabel, setSyncLabel] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chaptersOpen, setChaptersOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  const [notesScope, setNotesScope] = useState<'page' | 'all'>('page')
  const [allAnnotations, setAllAnnotations] = useState<CoreadAnnotation[]>([])
  const [settings, setSettings] = useState<ReaderSettings>(() => loadSettings(night))
  const scroller = useRef<HTMLDivElement>(null)
  const progressTimer = useRef<ReturnType<typeof setTimeout>>()
  const pendingProgress = useRef<{ paragraph_idx: number; offset: number } | null>(null)
  const lastProgress = useRef('')

  const sendProgress = useCallback((workId: string, progress: CoreadProgress) => (
    api.progress(actor, workId, progress.paragraph_idx, progress.offset, progress.updated_at)
  ), [actor])

  const flushProgress = useCallback(async () => {
    if (progressTimer.current) clearTimeout(progressTimer.current)
    progressTimer.current = undefined
    const pending = pendingProgress.current
    pendingProgress.current = null
    if (!pending) return
    try {
      const saved = await saveLocalCoreadProgress(actor, work.id, pending.paragraph_idx, pending.offset)
      setSyncLabel(navigator.onLine ? '正在同步…' : '离线已保存')
      setSlice(value => value ? { ...value, progress: { ...value.progress, [actor]: saved } } : value)
      if (navigator.onLine) {
        await flushOfflineCoreadProgress(actor, sendProgress)
        setSyncLabel('已同步')
      }
    } catch { setSyncLabel(navigator.onLine ? '等待同步' : '离线已保存') }
  }, [actor, sendProgress, work.id])

  const restorePosition = useCallback((progress?: CoreadProgress) => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const root = scroller.current
      if (!root) return
      const target = progress ? root.querySelector<HTMLElement>(`[data-paragraph="${progress.paragraph_idx}"]`) : null
      if (!target) { root.scrollTop = 0; return }
      const ratio = Math.min(1, progress!.offset / Math.max(1, target.textContent?.length || 1))
      root.scrollTop = Math.max(0, target.offsetTop + target.offsetHeight * ratio - 84)
    }))
  }, [])

  const load = useCallback(async (params: { start?: number; chapter_id?: string } = {}) => {
    setLoading(true); setError('')
    const cached = await getOfflineCoreadBook(work.id).catch(() => undefined)
    const local = await readLocalCoreadProgress(actor, work.id).catch(() => undefined)
    if (!navigator.onLine) {
      if (cached) {
        const data = offlineSlice(cached, actor, params, local)
        setSlice(data); setOffline(true); setSyncLabel('离线阅读中')
        restorePosition(params.start !== undefined || params.chapter_id ? undefined : newestCoreadProgress(local, cached.progress[actor]))
      } else setError('这本书还没有下载到 iPad，请联网后先下载')
      setLoading(false)
      return
    }
    try {
      const data = await api.coread(work.id, actor, { ...params, limit: 40 })
      const progress = newestCoreadProgress(local, data.progress?.[actor])
      data.progress = { ...data.progress, [actor]: progress }
      setSlice(data); setOffline(false); setSyncLabel(local ? '等待同步' : '已同步')
      restorePosition(params.start !== undefined || params.chapter_id ? undefined : progress)
      if (local) void flushOfflineCoreadProgress(actor, sendProgress).then(() => setSyncLabel('已同步')).catch(() => setSyncLabel('等待同步'))
    } catch (err: any) {
      if (cached) {
        const data = offlineSlice(cached, actor, params, local)
        setSlice(data); setOffline(true); setSyncLabel('离线阅读中')
        restorePosition(params.start !== undefined || params.chapter_id ? undefined : newestCoreadProgress(local, cached.progress[actor]))
      } else setError(err?.message || '正文加载失败')
    }
    setLoading(false)
  }, [actor, restorePosition, sendProgress, work.id])

  useEffect(() => {
    void load()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const online = () => { void flushOfflineCoreadProgress(actor, sendProgress).then(() => { setOffline(false); setSyncLabel('已同步') }).catch(() => { setOffline(true); setSyncLabel('等待同步') }) }
    const hidden = () => { if (document.visibilityState === 'hidden') void flushProgress() }
    window.addEventListener('online', online)
    document.addEventListener('visibilitychange', hidden)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('online', online)
      document.removeEventListener('visibilitychange', hidden)
      void flushProgress()
    }
  }, [actor, flushProgress, load, sendProgress])

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch {}
  }, [settings])

  const visiblePosition = () => {
    const root = scroller.current
    if (!root) return null
    const top = root.getBoundingClientRect().top + 104
    let current: HTMLElement | undefined
    for (const item of Array.from(root.querySelectorAll<HTMLElement>('[data-paragraph]'))) {
      if (item.getBoundingClientRect().top <= top) current = item
      else break
    }
    if (!current) return null
    const rect = current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (top - rect.top) / Math.max(1, rect.height)))
    return { paragraph_idx: Number(current.dataset.paragraph), offset: Math.round((current.textContent?.length || 0) * ratio) }
  }

  const rememberVisible = () => {
    const progress = visiblePosition()
    if (!progress) return
    const key = `${progress.paragraph_idx}:${progress.offset}`
    if (key === lastProgress.current) return
    lastProgress.current = key
    pendingProgress.current = progress
    if (progressTimer.current) clearTimeout(progressTimer.current)
    progressTimer.current = setTimeout(() => { void flushProgress() }, 500)
  }
  const saveVisible = () => {
    const progress = visiblePosition()
    if (progress) pendingProgress.current = progress
    return flushProgress()
  }
  const closeReader = () => { const saving = saveVisible(); onClose(); void saving.finally(onChanged) }
  const navigate = (params: { start?: number; chapter_id?: string }) => { void saveVisible(); setChaptersOpen(false); void load(params) }
  const chapterAt = (paragraph: number) => slice?.book.chapters.find(item => paragraph >= item.start_idx && paragraph <= item.end_idx)
  const shareQuote = (text: string, paragraph: number, content = '') => {
    const chapter = chapterAt(paragraph)
    shareToChat({
      kind: 'coread-quote', title: `📖 《${work.title}》`, subtitle: chapter?.title || '共读划线',
      body: [`“${text}”`, content].filter(Boolean).join('\n\n'),
      metadata: { work_id: work.id, paragraph_idx: paragraph, chapter_id: chapter?.id },
    })
  }
  const refreshAnnotations = useCallback(async () => {
    const cached = await getOfflineCoreadBook(work.id).catch(() => undefined)
    if (!navigator.onLine) { setAllAnnotations(cached?.annotations || []); return }
    try { const data = await api.coreadAnnotations(work.id); setAllAnnotations(data.annotations || []) }
    catch { setAllAnnotations(cached?.annotations || []) }
  }, [work.id])
  const openNotes = () => { setNotesOpen(true); void refreshAnnotations() }
  const startEdit = (annotation: CoreadAnnotation) => {
    setEditing(annotation); setSelection(null); setReply(null); setDraft(annotation.content); setNotesOpen(false)
  }

  const captureSelection = () => {
    const selected = window.getSelection()
    if (!selected || selected.isCollapsed || !selected.rangeCount) return
    const range = selected.getRangeAt(0)
    const parent = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
    const startElement = parent(range.startContainer)?.closest<HTMLElement>('[data-paragraph]')
    const endElement = parent(range.endContainer)?.closest<HTMLElement>('[data-paragraph]')
    if (!startElement || startElement !== endElement) return
    const prefix = document.createRange(); prefix.selectNodeContents(startElement); prefix.setEnd(range.startContainer, range.startOffset)
    const start = prefix.toString().length
    const text = range.toString().trim()
    if (!text) return
    setSelection({ paragraph_idx: Number(startElement.dataset.paragraph), start_offset: start, end_offset: start + range.toString().length, text })
    setReply(null); setEditing(null); setDraft('')
  }

  const send = async () => {
    if ((!selection && !reply && !editing) || ((reply || editing) && !draft.trim())) return
    if (!navigator.onLine) { setError('离线时可以阅读，联网后再写批注'); return }
    setBusy(true)
    try {
      await api.annotate(actor, work.id, editing ? { annotation_id: editing.id, content: draft.trim() } : reply ? { reply_to: reply.id, content: draft.trim() } : { ...selection, content: draft.trim() })
      setSelection(null); setReply(null); setEditing(null); setDraft(''); window.getSelection()?.removeAllRanges()
      await load({ start: slice?.paragraphs[0]?.idx })
      await refreshAnnotations()
      onChanged()
    } catch (err: any) { setError(err?.message || '批注保存失败') }
    setBusy(false)
  }

  const remove = async (annotation: CoreadAnnotation) => {
    if (!navigator.onLine) { setError('联网后才可以删除批注'); return }
    if (!window.confirm('删除这条批注？')) return
    try { await api.removeAnnotation(actor, work.id, annotation.id); await load({ start: slice?.paragraphs[0]?.idx }); await refreshAnnotations(); onChanged() }
    catch (err: any) { setError(err?.message || '批注删除失败') }
  }

  const other: MediaActor = actor === 'fire' ? 'star' : 'fire'
  const dark = settings.tone === 'night'
  const background = dark ? 'bg-[#171412] text-[#f2ebe4]' : settings.tone === 'soft' ? 'bg-[#e9eadc] text-[#3f3732]' : 'bg-[#f4eee4] text-[#493a35]'
  const surface = dark ? 'border-white/10 bg-[#211d1a]' : 'border-[#6d5148]/15 bg-[#fbf7f0]'
  const muted = dark ? 'text-[#b2a69e]' : 'text-[#897b74]'
  const width = settings.width === 'narrow' ? '680px' : settings.width === 'wide' ? '980px' : '800px'
  const pageAnnotations = slice?.annotations || []
  const pageRoots = pageAnnotations.filter(item => !item.reply_to)
  const shownAnnotations = notesScope === 'all' ? allAnnotations : pageAnnotations
  const shownRoots = shownAnnotations.filter(item => !item.reply_to)

  const content = <div className={`fixed inset-0 z-[130] flex h-[100dvh] flex-col ${background}`}>
    <header className="shrink-0 border-b border-current/10 bg-inherit px-3 pb-2 pt-[max(.5rem,env(safe-area-inset-top))]">
      <div className="mx-auto flex max-w-6xl items-center gap-1">
        <button onClick={closeReader} className="grid h-11 w-11 place-items-center rounded-full" aria-label="返回书影记录"><ChevronLeft size={20}/></button>
        <button onClick={() => setChaptersOpen(true)} className="grid h-11 w-11 place-items-center rounded-full" aria-label="章节目录"><List size={18}/></button>
        <div className="min-w-0 flex-1 text-center"><h1 className="truncate text-sm font-medium">{work.title}</h1><p className={`truncate text-[11px] ${muted}`}>{slice?.book.file_name || '共读'}</p></div>
        <button onClick={openNotes} className="relative grid h-11 w-11 place-items-center rounded-full" aria-label="查看批注"><MessageCircle size={18}/>{pageRoots.length > 0 && <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-[#d5b4b0] px-1 text-[9px] leading-4 text-[#4d3834]">{pageRoots.length}</span>}</button>
        <button onClick={() => setSettingsOpen(true)} className="grid h-11 w-11 place-items-center rounded-full" aria-label="阅读设置"><Settings2 size={18}/></button>
      </div>
      {slice && <div className={`mx-auto flex max-w-6xl items-center justify-center gap-4 text-[10px] ${muted}`}><span>{icon(actor)} {percent(slice.progress[actor], slice.book.paragraph_count)}%</span><span className="opacity-60">{icon(other)} {percent(slice.progress[other], slice.book.paragraph_count)}%</span><span className="flex items-center gap-1">{offline && <WifiOff size={11}/>} {syncLabel}</span></div>}
    </header>

    <div ref={scroller} onScroll={rememberVisible} onMouseUp={captureSelection} onTouchEnd={() => setTimeout(captureSelection, 80)} className="min-h-0 flex-1 overflow-y-auto px-5 py-8">
      <main className="mx-auto" style={{ maxWidth: width }}>
        {loading && <p className={`py-20 text-center text-sm ${muted}`}>翻到上次读的位置…</p>}
        {error && <button type="button" onClick={() => setError('')} role="alert" className="mb-5 w-full rounded-xl bg-red-500/10 p-3 text-left text-sm text-red-500">{error}</button>}
        {!loading && slice?.paragraphs.map(paragraph => {
          const count = pageRoots.filter(item => item.paragraph_idx === paragraph.idx).length
          return <section key={paragraph.idx} className="mb-8">
            <p data-paragraph={paragraph.idx} className={`whitespace-pre-wrap selection:bg-[#d5b4b0]/55 ${settings.family === 'serif' ? 'font-serif' : 'font-sans'}`} style={{ fontSize: settings.fontSize, lineHeight: settings.lineHeight, letterSpacing: settings.family === 'serif' ? '.015em' : '0' }}>{paragraph.text}</p>
            {count > 0 && <button onClick={openNotes} className={`mt-2 flex items-center gap-1 text-[11px] ${muted}`}><MessageCircle size={12}/>{count} 条批注</button>}
          </section>
        })}
        {slice && <div className="flex items-center justify-between py-8"><button disabled={slice.previous === null} onClick={() => navigate({ start: slice.previous! })} className="flex min-h-11 items-center gap-1 text-xs disabled:opacity-20"><ChevronLeft size={15}/>往前读</button><span className={`text-[10px] ${muted}`}>{slice.paragraphs[0]?.idx + 1}–{(slice.paragraphs.at(-1)?.idx ?? 0) + 1} / {slice.book.paragraph_count}</span><button disabled={slice.next === null} onClick={() => navigate({ start: slice.next! })} className="flex min-h-11 items-center gap-1 text-xs disabled:opacity-20">继续往后<ChevronRight size={15}/></button></div>}
      </main>
    </div>

    {(selection || reply || editing) && <div className={`shrink-0 border-t p-3 pb-[max(.75rem,env(safe-area-inset-bottom))] ${surface}`}><div className="mx-auto max-w-3xl"><div className="flex items-start justify-between gap-3 text-xs"><p className="line-clamp-2 min-w-0 opacity-55">{editing ? `编辑批注：“${editing.selected_text}”` : reply ? `回复 ${person(reply.author)}：${reply.content || reply.selected_text}` : `“${selection?.text}”`}</p><button onClick={() => { setSelection(null); setReply(null); setEditing(null) }}><X size={15}/></button></div><div className="mt-2 flex gap-2"><input autoFocus value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void send() }} placeholder={editing ? '修改批注…' : reply ? '写下回复…' : offline ? '离线时可以先分享这句话' : '批注可以留空，只划线'} className="min-w-0 flex-1 rounded-xl border border-current/10 bg-transparent px-3 py-2 text-base outline-none"/>{selection && <button onClick={() => shareQuote(selection.text, selection.paragraph_idx)} aria-label="把划线分享到 Chat" title="分享到 Chat" className="grid h-11 w-11 place-items-center rounded-xl"><Share2 size={16}/></button>}<button disabled={busy || offline || (!!(reply || editing) && !draft.trim())} onClick={() => void send()} className="grid h-11 w-11 place-items-center rounded-xl disabled:opacity-30"><Send size={17}/></button></div></div></div>}

    {chaptersOpen && <div className="absolute inset-0 z-20"><button aria-label="收起目录" onClick={() => setChaptersOpen(false)} className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"/><aside className={`absolute inset-y-0 left-0 w-[min(86vw,360px)] overflow-y-auto border-r p-4 pt-[max(1rem,env(safe-area-inset-top))] ${surface}`}><div className="flex items-center justify-between"><h2 className="text-sm font-medium">章节目录</h2><button onClick={() => setChaptersOpen(false)} className="grid h-11 w-11 place-items-center"><X size={17}/></button></div><div className="mt-3 space-y-1">{slice?.book.chapters.map(chapter => <button key={chapter.id} onClick={() => navigate({ chapter_id: chapter.id })} className="w-full rounded-xl px-3 py-3 text-left text-sm hover:bg-current/5">{chapter.title}</button>)}</div></aside></div>}

    {notesOpen && <div className="absolute inset-0 z-20"><button aria-label="收起批注" onClick={() => setNotesOpen(false)} className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"/><aside className={`absolute inset-x-0 bottom-0 max-h-[72%] overflow-y-auto rounded-t-[26px] border-t p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:inset-y-0 sm:left-auto sm:w-96 sm:max-h-none sm:rounded-none sm:border-l sm:border-t-0 ${surface}`}>
      <div className="flex items-center justify-between"><div><h2 className="text-sm font-medium">共读批注</h2>{offline && <p className={`mt-1 text-[10px] ${muted}`}>显示上次同步的内容</p>}</div><button onClick={() => setNotesOpen(false)} className="grid h-11 w-11 place-items-center"><ChevronDown className="sm:hidden" size={18}/><X className="hidden sm:block" size={17}/></button></div>
      <div className="mt-1 flex rounded-xl bg-current/5 p-1 text-xs"><button onClick={() => setNotesScope('page')} className={`flex-1 rounded-lg py-2 ${notesScope === 'page' ? 'bg-[#d5b4b0]/30' : 'opacity-50'}`}>本页 · {pageRoots.length}</button><button onClick={() => { setNotesScope('all'); void refreshAnnotations() }} className={`flex-1 rounded-lg py-2 ${notesScope === 'all' ? 'bg-[#d5b4b0]/30' : 'opacity-50'}`}>全部 · {allAnnotations.filter(item => !item.reply_to).length}</button></div>
      <div className="mt-3 space-y-3">{shownRoots.length ? shownRoots.map(annotation => <article key={annotation.id} className="rounded-xl border border-current/10 p-3 text-xs">
        <button onClick={() => { setNotesOpen(false); navigate({ start: annotation.paragraph_idx }) }} className="w-full text-left font-serif leading-5 opacity-65">“{annotation.selected_text}”</button>
        {annotation.content && <p className="mt-2 leading-5"><b>{icon(annotation.author)} {person(annotation.author)}</b>：{annotation.content}</p>}
        {shownAnnotations.filter(item => item.reply_to === annotation.id).map(item => <div key={item.id} className="mt-2 border-t border-current/10 pt-2 leading-5"><b>{icon(item.author)} {person(item.author)}</b>：{item.content}<div className="mt-1 flex gap-3 opacity-45"><button onClick={() => shareQuote(item.selected_text, item.paragraph_idx, item.content)} aria-label="分享这条回复"><Share2 size={11}/></button>{item.author === actor && <><button disabled={offline} onClick={() => startEdit(item)} aria-label="编辑回复" className="disabled:opacity-30"><Pencil size={11}/></button><button disabled={offline} onClick={() => void remove(item)} aria-label="删除回复" className="disabled:opacity-30"><Trash2 size={11}/></button></>}</div></div>)}
        <div className="mt-2 flex gap-4 opacity-50"><button disabled={offline} onClick={() => { setReply(annotation); setSelection(null); setEditing(null); setDraft(''); setNotesOpen(false) }} className="flex items-center gap-1 disabled:opacity-30"><MessageCircle size={11}/>回复</button><button onClick={() => shareQuote(annotation.selected_text, annotation.paragraph_idx, annotation.content)} className="flex items-center gap-1"><Share2 size={11}/>分享</button>{annotation.author === actor && annotation.content && <button disabled={offline} onClick={() => startEdit(annotation)} className="disabled:opacity-30"><Pencil size={11}/></button>}{annotation.author === actor && <button disabled={offline} onClick={() => void remove(annotation)} className="disabled:opacity-30"><Trash2 size={11}/></button>}</div>
      </article>) : <p className={`py-12 text-center text-sm ${muted}`}>{notesScope === 'page' ? <>这一页还没有批注。<br/>选中文字就可以留下第一条。</> : '还没有任何共读批注。'}</p>}</div>
    </aside></div>}

    {settingsOpen && <div className="absolute inset-0 z-30"><button aria-label="收起阅读设置" onClick={() => setSettingsOpen(false)} className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"/><section className={`absolute inset-x-0 bottom-0 rounded-t-[26px] border-t px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 ${surface}`}><div className="mx-auto max-w-2xl"><div className="mx-auto h-1 w-10 rounded-full bg-current/15"/><div className="mt-1 flex items-center justify-between"><h2 className="text-sm font-medium">阅读设置</h2><button onClick={() => setSettingsOpen(false)} className="grid h-11 w-11 place-items-center"><ChevronDown size={18}/></button></div><SettingRow label="字号"><div className="flex items-center rounded-xl bg-current/5 p-1"><button onClick={() => setSettings(value => ({ ...value, fontSize: Math.max(15, value.fontSize - 1) }))} className="h-9 w-11">−</button><span className={`w-10 text-center text-xs ${muted}`}>{settings.fontSize}</span><button onClick={() => setSettings(value => ({ ...value, fontSize: Math.min(24, value.fontSize + 1) }))} className="h-9 w-11">＋</button></div></SettingRow><SettingRow label="字体"><Segment value={settings.family} options={[['serif','宋体'],['sans','黑体']]} setValue={family => setSettings(value => ({ ...value, family: family as ReaderSettings['family'] }))}/></SettingRow><SettingRow label="页面"><Segment value={settings.tone} options={[['paper','纸张'],['soft','护眼'],['night','夜间']]} setValue={tone => setSettings(value => ({ ...value, tone: tone as ReaderSettings['tone'] }))}/></SettingRow><SettingRow label="行距"><Segment value={String(settings.lineHeight)} options={[['1.7','紧凑'],['2','舒展'],['2.25','宽松']]} setValue={lineHeight => setSettings(value => ({ ...value, lineHeight: Number(lineHeight) }))}/></SettingRow><SettingRow label="版心"><Segment value={settings.width} options={[['narrow','窄'],['medium','中'],['wide','宽']]} setValue={pageWidth => setSettings(value => ({ ...value, width: pageWidth as ReaderSettings['width'] }))}/></SettingRow><div className={`mt-3 flex items-center justify-center gap-2 rounded-xl py-3 text-xs ${offline ? 'bg-[#d5b4b0]/20' : 'bg-current/5'} ${muted}`}>{offline ? <><WifiOff size={14}/>离线阅读中，进度保存在这台设备</> : <><Check size={14}/>设置只保存在这台设备</>}</div></div></section></div>}
  </div>

  return typeof document === 'undefined' ? null : createPortal(content, document.body)
}

function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="flex min-h-14 items-center justify-between gap-3 border-t border-current/10 text-sm"><span>{label}</span>{children}</div>
}

function Segment({ value, options, setValue }: { value: string; options: [string, string][]; setValue: (value: string) => void }) {
  return <div className="flex rounded-xl bg-current/5 p-1">{options.map(([key, label]) => <button key={key} onClick={() => setValue(key)} className={`min-h-9 rounded-lg px-3 text-xs ${value === key ? 'bg-[#d5b4b0]/35' : 'opacity-55'}`}>{label}</button>)}</div>
}
