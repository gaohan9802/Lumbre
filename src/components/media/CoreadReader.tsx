'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, MessageCircle, Send, Trash2, X } from 'lucide-react'
import { mediaLibrary as api } from '@/lib/api'
import type { CoreadAnnotation, CoreadChapter, CoreadParagraph, CoreadProgress } from '@/lib/coread'
import type { MediaActor, MediaWork } from '@/lib/media-library'

type Slice = {
  book: { file_name: string; format: string; chapters: CoreadChapter[]; paragraph_count: number }
  paragraphs: CoreadParagraph[]
  progress: Partial<Record<MediaActor, CoreadProgress>>
  annotations: CoreadAnnotation[]
  next: number | null
  previous: number | null
}

const person = (actor: MediaActor) => actor === 'fire' ? '小火' : '星星'
const icon = (actor: MediaActor) => actor === 'fire' ? '🦦' : '🐆'
const percent = (progress: CoreadProgress | undefined, total: number) => progress && total > 1 ? Math.round(progress.paragraph_idx / (total - 1) * 100) : 0

export function CoreadReader({ work, actor, night, onClose, onChanged }: { work: MediaWork; actor: MediaActor; night: boolean; onClose: () => void; onChanged: () => void }) {
  const [slice, setSlice] = useState<Slice | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState<{ paragraph_idx: number; start_offset: number; end_offset: number; text: string } | null>(null)
  const [reply, setReply] = useState<CoreadAnnotation | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const progressTimer = useRef<ReturnType<typeof setTimeout>>()
  const lastProgress = useRef(-1)

  const load = useCallback(async (params: { start?: number; chapter_id?: string } = {}) => {
    setLoading(true); setError('')
    try {
      const data = await api.coread(work.id, actor, { ...params, limit: 24 })
      setSlice(data); lastProgress.current = data.progress?.[actor]?.paragraph_idx ?? -1
      requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = 0 })
    } catch (err: any) { setError(err?.message || '正文加载失败') }
    setLoading(false)
  }, [actor, work.id])

  useEffect(() => { void load(); return () => { if (progressTimer.current) clearTimeout(progressTimer.current) } }, [load])

  const rememberVisible = () => {
    const root = scroller.current
    if (!root) return
    const top = root.getBoundingClientRect().top + 120
    let current: HTMLElement | undefined
    for (const item of Array.from(root.querySelectorAll<HTMLElement>('[data-paragraph]'))) {
      if (item.getBoundingClientRect().top <= top) current = item
      else break
    }
    const idx = Number(current?.dataset.paragraph)
    if (!Number.isInteger(idx) || idx === lastProgress.current) return
    lastProgress.current = idx
    setSlice(value => value ? { ...value, progress: { ...value.progress, [actor]: { paragraph_idx: idx, offset: 0, updated_at: new Date().toISOString() } } } : value)
    if (progressTimer.current) clearTimeout(progressTimer.current)
    progressTimer.current = setTimeout(() => { void api.progress(actor, work.id, idx).catch(() => {}) }, 700)
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
    setReply(null); setDraft('')
  }

  const send = async () => {
    if ((!selection && !reply) || (reply && !draft.trim())) return
    setBusy(true)
    try {
      await api.annotate(actor, work.id, reply ? { reply_to: reply.id, content: draft.trim() } : { ...selection, content: draft.trim() })
      setSelection(null); setReply(null); setDraft(''); window.getSelection()?.removeAllRanges()
      await load({ start: slice?.paragraphs[0]?.idx })
      onChanged()
    } catch (err: any) { setError(err?.message || '批注保存失败') }
    setBusy(false)
  }

  const remove = async (annotation: CoreadAnnotation) => {
    if (!window.confirm('删除这条批注？')) return
    try { await api.removeAnnotation(actor, work.id, annotation.id); await load({ start: slice?.paragraphs[0]?.idx }); onChanged() }
    catch (err: any) { setError(err?.message || '批注删除失败') }
  }

  const panel = night ? 'border-night-border bg-night-card' : 'border-[#a73a32]/15 bg-[#fffaf5]'
  const muted = night ? 'text-night-muted' : 'text-day-muted'
  const other: MediaActor = actor === 'fire' ? 'star' : 'fire'

  return <div className={`absolute inset-0 z-20 flex flex-col ${night ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
    <header className={`shrink-0 border-b px-3 py-2 ${night ? 'border-night-border bg-night-bg/95' : 'border-[#a73a32]/10 bg-[#fffaf5]/95'}`}>
      <div className="mx-auto flex max-w-3xl items-center gap-2"><button onClick={onClose} className="p-2" aria-label="返回"><ChevronLeft size={19}/></button><div className="min-w-0 flex-1"><h1 className="truncate text-sm font-medium">{work.title}</h1><p className={`truncate text-[10px] ${muted}`}>{slice?.book.file_name || '共读'}</p></div>{slice && <select aria-label="章节" value={slice.paragraphs[0]?.chapter_id || ''} onChange={event => void load({ chapter_id: event.target.value })} className="max-w-32 rounded-lg border border-current/10 bg-transparent px-2 py-1 text-xs outline-none">{slice.book.chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title}</option>)}</select>}<button onClick={onClose} className="p-2 opacity-50" aria-label="关闭"><X size={18}/></button></div>
      {slice && <div className="mx-auto mt-1 flex max-w-3xl gap-4 px-10 text-[10px]"><span>{icon(actor)} {person(actor)} {percent(slice.progress[actor], slice.book.paragraph_count)}%</span><span className="opacity-55">{icon(other)} {person(other)} {percent(slice.progress[other], slice.book.paragraph_count)}%</span></div>}
    </header>
    <div ref={scroller} onScroll={rememberVisible} onMouseUp={captureSelection} onTouchEnd={() => setTimeout(captureSelection, 80)} className="min-h-0 flex-1 overflow-y-auto px-4 py-6">
      <main className="mx-auto max-w-2xl">
        {loading && <p className={`py-20 text-center text-sm ${muted}`}>翻到上次读的位置…</p>}
        {error && <p role="alert" className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
        {!loading && slice?.paragraphs.map(paragraph => {
          const roots = slice.annotations.filter(item => item.paragraph_idx === paragraph.idx && !item.reply_to)
          return <section key={paragraph.idx} className="mb-7"><p data-paragraph={paragraph.idx} className="whitespace-pre-wrap font-serif text-[17px] leading-8 selection:bg-[#DBB9B3]/45">{paragraph.text}</p>{roots.map(annotation => <div key={annotation.id} className={`mt-3 rounded-xl border-l-2 p-3 text-xs ${panel}`}><p className="font-serif leading-5 opacity-70">“{annotation.selected_text}”</p>{annotation.content && <p className="mt-2 leading-5"><b>{icon(annotation.author)} {person(annotation.author)}</b>：{annotation.content}</p>}{slice.annotations.filter(item => item.reply_to === annotation.id).map(item => <p key={item.id} className="mt-2 border-t border-current/10 pt-2 leading-5"><b>{icon(item.author)} {person(item.author)}</b>：{item.content}{item.author === actor && <button onClick={() => void remove(item)} className="ml-2 opacity-35"><Trash2 size={11}/></button>}</p>)}<div className="mt-2 flex gap-3 opacity-45"><button onClick={() => { setReply(annotation); setSelection(null); setDraft('') }} className="flex items-center gap-1"><MessageCircle size={11}/>回复</button>{annotation.author === actor && <button onClick={() => void remove(annotation)}><Trash2 size={11}/></button>}</div></div>)}</section>
        })}
        {slice && <div className="flex items-center justify-between py-6"><button disabled={slice.previous === null} onClick={() => void load({ start: slice.previous! })} className="flex items-center gap-1 text-xs disabled:opacity-20"><ChevronLeft size={15}/>上一段</button><span className={`text-[10px] ${muted}`}>{slice.paragraphs[0]?.idx + 1}–{(slice.paragraphs.at(-1)?.idx ?? 0) + 1} / {slice.book.paragraph_count}</span><button disabled={slice.next === null} onClick={() => void load({ start: slice.next! })} className="flex items-center gap-1 text-xs disabled:opacity-20">下一段<ChevronRight size={15}/></button></div>}
      </main>
    </div>
    {(selection || reply) && <div className={`shrink-0 border-t p-3 ${night ? 'border-night-border bg-night-bg' : 'border-[#a73a32]/10 bg-[#fffaf5]'}`}><div className="mx-auto max-w-2xl"><div className="flex items-start justify-between gap-3 text-xs"><p className="line-clamp-2 min-w-0 opacity-55">{reply ? `回复 ${person(reply.author)}：${reply.content || reply.selected_text}` : `“${selection?.text}”`}</p><button onClick={() => { setSelection(null); setReply(null) }}><X size={15}/></button></div><div className="mt-2 flex gap-2"><input autoFocus value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void send() }} placeholder={reply ? '写下回复…' : '批注可以留空，只划线'} className="min-w-0 flex-1 rounded-xl border border-current/10 bg-transparent px-3 py-2 text-sm outline-none"/><button disabled={busy || (!!reply && !draft.trim())} onClick={() => void send()} className="rounded-xl px-3 disabled:opacity-30"><Send size={17}/></button></div></div></div>}
  </div>
}
