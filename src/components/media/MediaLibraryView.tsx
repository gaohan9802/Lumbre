'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronLeft, Clapperboard, FileUp, MessageCircle, Plus, Search, Share2, Star, Trash2, Tv, UsersRound, X } from 'lucide-react'
import { mediaLibrary as api } from '@/lib/api'
import type { MediaActor, MediaCatalogItem, MediaEvent, MediaKind, MediaNoteType, MediaStatus, MediaTimelineItem, MediaWork } from '@/lib/media-library'
import { shareToChat } from '@/lib/share'
import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { CoreadReader } from './CoreadReader'

const KIND: Record<MediaKind, { label: string; icon: typeof BookOpen }> = {
  book: { label: '书', icon: BookOpen }, movie: { label: '电影', icon: Clapperboard }, tv: { label: '剧集', icon: Tv },
}
const STATUS: Record<MediaStatus, string> = { planned: '想读 / 想看', in_progress: '正在读 / 看', completed: '读完 / 看完' }
const EVENT: Record<MediaEvent['type'], string> = {
  added: '收进了书影库', planned: '想读 / 想看', started: '开始了', finished: '完成了', rated: '打了分', reviewed: '写了评价', note: '写了笔记', quote: '记下了摘抄',
  coread_requested: '发起了共读', coread_ready: '把书放进了共读书架', coread_annotation: '留下了共读批注',
}
const person = (actor: MediaActor) => actor === 'fire' ? '小火' : '星星'
const icon = (actor: MediaActor) => actor === 'fire' ? '🦦' : '🐆'
const when = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Europe/Madrid', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
const coverUrl = (work: Pick<MediaWork, 'cover_url' | 'source'>) => {
  if (!work.cover_url || work.source?.provider !== 'douban-book') return work.cover_url
  try {
    const url = new URL(work.cover_url)
    if (url.protocol === 'https:' && url.hostname.endsWith('.doubanio.com')) return `/api/media-library?mode=douban-cover&id=${encodeURIComponent(work.source.id)}&url=${encodeURIComponent(url.toString())}`
  } catch {}
  return work.cover_url
}

export function MediaLibraryView() {
  const { currentUser } = useApp()
  const { theme } = useTheme()
  const night = theme === 'night'
  const [tab, setTab] = useState<'library' | 'coread' | 'timeline'>('library')
  const [works, setWorks] = useState<MediaWork[]>([])
  const [events, setEvents] = useState<MediaTimelineItem[]>([])
  const [selected, setSelected] = useState<MediaWork | null>(null)
  const [kind, setKind] = useState<MediaKind | ''>('')
  const [status, setStatus] = useState<MediaStatus | ''>('')
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      if (tab === 'timeline') {
        const timeline = await api.timeline()
        setEvents(Array.isArray(timeline.events) ? timeline.events : [])
      } else {
        const library = await api.list(tab === 'coread' ? { coread: true } : { kind: kind || undefined, status: status || undefined })
        setWorks(Array.isArray(library.works) ? library.works : [])
      }
      if (selected) {
        const detail = await api.detail(selected.id)
        setSelected(detail.work)
      }
    } catch (err: any) { setError(err?.message || '书影记录加载失败') }
    setLoading(false)
  }, [kind, status, tab, selected?.id])

  useEffect(() => { void load() }, [kind, status, tab])

  const panel = night ? 'border-night-border bg-night-card' : 'border-[#a73a32]/15 bg-[#fffaf5]/80'
  const muted = night ? 'text-night-muted' : 'text-day-muted'
  if (selected) return <MediaDetail work={selected} actor={currentUser} night={night} onBack={() => setSelected(null)} onChanged={load}/>

  return <div className={`relative h-full overflow-y-auto ${night ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold">书影记录</h1><p className={`mt-1 text-xs ${muted}`}>只属于小火和星星的共同书架与银幕角落</p></div>
        <button onClick={() => setAddOpen(true)} className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm ${panel}`}><Plus size={15}/>添加</button>
      </div>
      <div className={`mt-5 flex rounded-xl border p-1 ${panel}`}>
        {([['library', '收藏'], ['coread', '共读'], ['timeline', '共同动态']] as const).map(([value, label]) => <button key={value} onClick={() => setTab(value)} className={`flex-1 rounded-lg px-3 py-2 text-sm ${tab === value ? (night ? 'bg-night-surface text-night-text' : 'bg-[#DBB9B3]/25 text-[#765953]') : muted}`}>{label}</button>)}
      </div>
      {tab === 'library' && <>
        <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
          <Filter value={kind} setValue={value => setKind(value as MediaKind | '')} values={[['', '全部'], ['book', '书'], ['movie', '电影'], ['tv', '剧集']]} night={night}/>
          <span className={`my-1 w-px shrink-0 ${night ? 'bg-night-border' : 'bg-[#a73a32]/15'}`}/>
          <Filter value={status} setValue={value => setStatus(value as MediaStatus | '')} values={[['', '全部状态'], ['planned', '想读/看'], ['in_progress', '进行中'], ['completed', '已完成']]} night={night}/>
        </div>
        {loading
          ? <p className={`py-16 text-center text-sm ${muted}`}>翻找书架中…</p>
          : works.length
            ? <Shelf works={works} night={night} onSelect={setSelected}/>
            : <Empty onAdd={() => setAddOpen(true)} muted={muted}/>
        }
      </>}
      {tab === 'coread' && (loading ? <p className={`py-16 text-center text-sm ${muted}`}>翻找共读书架中…</p> : works.length ? <Shelf works={works} night={night} onSelect={setSelected}/> : <div className={`flex min-h-56 flex-col items-center justify-center gap-3 text-center text-sm ${muted}`}><UsersRound size={34} strokeWidth={1.2}/><span>这里只放真正想一起读的书。<br/>可以由你开启，也可以等星星提出想读。</span></div>)}
      {tab === 'timeline' && <div className="mt-4 space-y-3">{loading ? <p className={`py-16 text-center text-sm ${muted}`}>整理共同动态中…</p> : events.length ? events.map(item => <EventCard key={item.id} item={item} actor={currentUser} night={night} onChanged={load}/>) : <p className={`py-16 text-center text-sm ${muted}`}>第一条书影动态还没发生。</p>}</div>}
      {error && <p role="alert" className="mt-4 text-sm text-red-500">{error}</p>}
    </div>
    {addOpen && <AddDialog actor={currentUser} night={night} onClose={() => setAddOpen(false)} onSaved={() => { setAddOpen(false); void load() }}/>}
  </div>
}

function Shelf({ works, night, onSelect }: { works: MediaWork[]; night: boolean; onSelect: (work: MediaWork) => void }) {
  return <div className="mt-4 grid grid-cols-3 gap-x-2.5 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7">{works.map(work => <WorkCard key={work.id} work={work} night={night} onClick={() => onSelect(work)}/>)}</div>
}

function Filter({ value, setValue, values, night }: { value: string; setValue: (value: string) => void; values: [string, string][]; night: boolean }) {
  return <>{values.map(([key, label]) => <button key={key} onClick={() => setValue(key)} className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs ${value === key ? (night ? 'bg-night-surface text-night-amber' : 'bg-[#DBB9B3]/20 text-[#765953]') : 'opacity-55'}`}>{label}</button>)}</>
}

function Empty({ onAdd, muted }: { onAdd: () => void; muted: string }) {
  return <button onClick={onAdd} className={`mx-auto flex min-h-56 w-full flex-col items-center justify-center gap-3 text-sm ${muted}`}><BookOpen size={34} strokeWidth={1.2}/><span>书架还是空的，放进第一本书或第一部电影</span></button>
}

function WorkCard({ work, night, onClick }: { work: MediaWork; night: boolean; onClick: () => void }) {
  const statuses = (['fire', 'star'] as MediaActor[]).filter(actor => work.records[actor])
  const progress = (actor: MediaActor) => work.coread?.paragraph_count && work.coread_progress?.[actor]
    ? Math.round(work.coread_progress[actor]!.paragraph_idx / Math.max(1, work.coread.paragraph_count - 1) * 100)
    : 0
  return <button onClick={onClick} className="group min-w-0 text-left outline-none" aria-label={`打开《${work.title}》`}>
    <div className={`relative overflow-hidden rounded-xl border shadow-sm transition group-hover:-translate-y-0.5 group-hover:shadow-md group-focus-visible:ring-2 ${night ? 'border-night-border bg-night-card ring-night-amber/50' : 'border-[#a73a32]/15 bg-[#fffaf5]/80 ring-[#a73a32]/25'}`}><Cover work={work}/>{work.coread && <span className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[8px] tracking-wide text-white">{work.coread.status === 'ready' ? '共读中' : '等文件'}</span>}</div>
    <div className="px-0.5 pt-2"><p className="line-clamp-2 text-xs font-medium leading-4">{work.title}</p><p className="mt-0.5 truncate text-[10px] opacity-45">{work.creators.join(' / ') || KIND[work.kind].label}</p>{work.coread?.status === 'ready' ? <p className="mt-1 truncate text-[9px] opacity-60">🦦 {progress('fire')}% · 🐆 {progress('star')}%</p> : statuses.length > 0 && <p className="mt-1 truncate text-[9px] opacity-55">{statuses.map(actor => `${icon(actor)} ${STATUS[work.records[actor]!.status].split(' / ')[0]}${work.records[actor]!.rating ? ` ${work.records[actor]!.rating}★` : ''}`).join(' · ')}</p>}</div>
  </button>
}

function Cover({ work }: { work: Pick<MediaWork, 'title' | 'cover_url' | 'kind' | 'source'> }) {
  const [failed, setFailed] = useState(false)
  const Icon = KIND[work.kind].icon
  const src = coverUrl(work)
  return <div className="aspect-[2/3] w-full bg-black/5">{src && !failed ? <img src={src} alt={`${work.title}封面`} onError={() => setFailed(true)} className="h-full w-full object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer"/> : <div className="flex h-full items-center justify-center opacity-30"><Icon size={38} strokeWidth={1.2}/></div>}</div>
}

function AddDialog({ actor, night, onClose, onSaved }: { actor: MediaActor; night: boolean; onClose: () => void; onSaved: () => void }) {
  const [kind, setKind] = useState<MediaKind>('book')
  const [query, setQuery] = useState('')
  const [doubanUrl, setDoubanUrl] = useState('')
  const [results, setResults] = useState<MediaCatalogItem[]>([])
  const [draft, setDraft] = useState<Partial<MediaCatalogItem> & { kind: MediaKind; title: string; creators: string[] }>({ kind: 'book', title: '', creators: [] })
  const [status, setStatus] = useState<MediaStatus>('planned')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const panel = night ? 'bg-night-surface text-night-text border-night-border' : 'chat-dialog'
  const input = `w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none ${night ? 'border-night-border' : 'border-[#a73a32]/15'}`
  const search = async () => {
    if (!query.trim()) return
    setBusy(true); setMessage('')
    try { const data = await api.search(kind, query.trim()); setResults(data.items || []); setMessage(data.warning || (data.providers?.length ? `资料来源：${data.providers.join('、')}` : '')) }
    catch (err: any) { setMessage(err?.message || '搜索失败，可以手动添加') }
    setBusy(false)
  }
  const choose = async (item: MediaCatalogItem) => {
    setBusy(true)
    try {
      const full = item.source.provider === 'tmdb' ? (await api.catalogDetail(item.kind, item.source.id)).item : item
      setDraft(full)
    } catch { setDraft(item) }
    setBusy(false); setResults([])
  }
  const importDouban = async () => {
    if (!doubanUrl.trim()) return
    setBusy(true); setMessage('')
    try { const data = await api.importUrl(doubanUrl.trim()); setDraft(data.item); setResults([]); setMessage('已从豆瓣读取，请确认后保存') }
    catch (err: any) { setMessage(err?.message || '豆瓣链接读取失败，可以手动填写') }
    setBusy(false)
  }
  const save = async () => {
    if (!draft.title.trim()) { setMessage('请先填写标题'); return }
    setBusy(true)
    try { await api.save(actor, { ...draft, title: draft.title.trim(), creators: draft.creators, status }); onSaved() }
    catch (err: any) { setMessage(err?.message || '保存失败'); setBusy(false) }
  }
  return <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/45 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="添加书影记录">
    <div className={`max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-[26px] border p-4 shadow-2xl ${panel}`}>
      <div className="flex items-center justify-between"><h2 className="font-medium">放进书影库</h2><button aria-label="关闭" onClick={onClose} className="p-2 opacity-60"><X size={18}/></button></div>
      <div className="mt-3 flex gap-2">{(['book', 'movie', 'tv'] as MediaKind[]).map(value => <button key={value} onClick={() => { setKind(value); setDraft({ kind: value, title: '', creators: [] }); setResults([]); setMessage('') }} className={`rounded-lg px-3 py-1.5 text-xs ${kind === value ? (night ? 'bg-night-card text-night-amber' : 'bg-[#DBB9B3]/25') : 'opacity-55'}`}>{KIND[value].label}</button>)}</div>
      {kind === 'book' && <div className="mt-3 flex gap-2"><input value={doubanUrl} onChange={event => setDoubanUrl(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void importDouban() }} placeholder="粘贴豆瓣读书链接" inputMode="url" className={input}/><button disabled={busy || !doubanUrl.trim()} onClick={importDouban} className="shrink-0 rounded-xl border px-3 text-xs">导入</button></div>}
      <div className="mt-3 flex gap-2"><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void search() }} placeholder={kind === 'book' ? '书名 / 作者 / ISBN（中文也可以）' : '片名'} className={input}/><button disabled={busy} onClick={search} className="rounded-xl border px-3"><Search size={17}/></button></div>
      {message && <p className="mt-2 text-xs opacity-60">{message}</p>}
      {results.length > 0 && <div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{results.map(item => <button key={item.key} onClick={() => void choose(item)} className={`flex w-full gap-3 rounded-xl border p-2 text-left ${night ? 'border-night-border bg-night-card' : 'border-[#a73a32]/15 bg-white/50'}`}>{item.cover_url ? <img src={item.cover_url} alt="" className="h-16 w-11 rounded object-cover" loading="lazy" decoding="async" referrerPolicy="no-referrer"/> : <div className="h-16 w-11 rounded bg-black/5"/>}<span className="min-w-0"><span className="block text-sm font-medium">{item.title}</span><span className="mt-1 block truncate text-xs opacity-55">{item.creators.join(' / ') || item.publisher || item.release_date || '暂无详细资料'}</span></span></button>)}</div>}
      <div className="my-4 flex items-center gap-3 text-[11px] opacity-45"><span className="h-px flex-1 bg-current"/>搜索不到也可以手动填<span className="h-px flex-1 bg-current"/></div>
      <div className="grid gap-2 sm:grid-cols-2"><input value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} placeholder="标题 *" className={input}/><input value={draft.creators.join('、')} onChange={event => setDraft({ ...draft, creators: event.target.value.split(/[、,，]/).map(value => value.trim()).filter(Boolean) })} placeholder={kind === 'book' ? '作者' : '导演 / 主创'} className={input}/>{kind === 'book' && <><input value={draft.publisher || ''} onChange={event => setDraft({ ...draft, publisher: event.target.value })} placeholder="出版社" className={input}/><input value={draft.isbn || ''} onChange={event => setDraft({ ...draft, isbn: event.target.value })} placeholder="ISBN" className={input}/><input value={draft.published_date || ''} onChange={event => setDraft({ ...draft, published_date: event.target.value })} placeholder="出版日期" className={input}/><input type="number" min="1" value={draft.page_count || ''} onChange={event => setDraft({ ...draft, page_count: event.target.value ? Number(event.target.value) : undefined })} placeholder="页数" className={input}/></>}<textarea value={draft.summary || ''} onChange={event => setDraft({ ...draft, summary: event.target.value })} placeholder="简介（可选）" rows={3} className={`${input} resize-none sm:col-span-2`}/><input value={draft.cover_url || ''} onChange={event => setDraft({ ...draft, cover_url: event.target.value })} placeholder="封面链接（可选）" className={`${input} sm:col-span-2`}/></div>
      <label className="mt-3 block text-xs opacity-60">我的状态</label><select value={status} onChange={event => setStatus(event.target.value as MediaStatus)} className={`${input} mt-1`}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <div className="mt-4 flex justify-end gap-2"><button onClick={onClose} className="px-4 py-2 text-sm opacity-60">取消</button><button disabled={busy} onClick={save} className={`rounded-xl px-4 py-2 text-sm ${night ? 'bg-night-card text-night-amber' : 'bg-[#DBB9B3]/25 text-[#765953]'}`}>{busy ? '处理中…' : '收进书影库'}</button></div>
    </div>
  </div>
}

function MediaDetail({ work, actor, night, onBack, onChanged }: { work: MediaWork; actor: MediaActor; night: boolean; onBack: () => void; onChanged: () => Promise<void> | void }) {
  const mine = work.records[actor]
  const [status, setStatus] = useState<MediaStatus>(mine?.status || 'planned')
  const [rating, setRating] = useState(mine?.rating || 0)
  const [review, setReview] = useState(mine?.review || '')
  const [noteType, setNoteType] = useState<MediaNoteType>('note')
  const [note, setNote] = useState('')
  const [locator, setLocator] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [readerOpen, setReaderOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ label: string; run: () => Promise<void> } | null>(null)
  const panel = night ? 'border-night-border bg-night-card' : 'border-[#a73a32]/15 bg-[#fffaf5]/80'
  const muted = night ? 'text-night-muted' : 'text-day-muted'
  const input = `w-full rounded-xl border bg-transparent px-3 py-2 text-sm outline-none ${night ? 'border-night-border' : 'border-[#a73a32]/15'}`
  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true); setMessage('')
    try { await action() }
    catch (err: any) { setPendingDelete(null); setMessage(`失败：${err?.message || fallback}`) }
    finally { setBusy(false) }
  }
  const saveRecord = () => run(async () => { await api.save(actor, { work_id: work.id, status, rating: rating || null, review }); await onChanged(); setMessage('记录已保存') }, '记录保存失败')
  const saveNote = () => { if (!note.trim()) return; void run(async () => { await api.note(actor, work.id, { type: noteType, content: note, locator }); setNote(''); setLocator(''); await onChanged(); setMessage('已经记下来了') }, '笔记保存失败') }
  const removeRecord = () => run(async () => { await api.remove(actor, { type: 'record', work_id: work.id }); setPendingDelete(null); onBack(); await onChanged() }, '记录删除失败')
  const shareWork = () => shareToChat({
    kind: 'media', title: `${work.kind === 'book' ? '📚' : '🎬'} ${work.title}`,
    subtitle: [work.creators.join(' / '), work.publisher, work.published_date || work.release_date].filter(Boolean).join(' · '),
    body: [work.summary, ...(['fire', 'star'] as MediaActor[]).map(who => { const record = work.records[who]; return record ? `${person(who)}：${STATUS[record.status]}${record.rating ? ` · ${record.rating}★` : ''}${record.review ? `\n${record.review}` : ''}` : '' }).filter(Boolean), ...work.notes.slice(-3).map(item => `${person(item.author)}的${item.type === 'quote' ? '摘抄' : '笔记'}${item.locator ? `（${item.locator}）` : ''}：${item.content}`)].filter(Boolean).join('\n\n').slice(0, 6000),
    imageUrl: coverUrl(work),
    metadata: { id: work.id, kind: work.kind, source: work.source, fire_status: work.records.fire?.status, star_status: work.records.star?.status },
  })
  if (readerOpen) return <CoreadReader work={work} actor={actor} night={night} onClose={() => setReaderOpen(false)} onChanged={() => { void onChanged() }}/>
  return <div className={`relative h-full overflow-y-auto ${night ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
    <div className="mx-auto max-w-4xl px-4 pb-24 pt-2">
      <button onClick={onBack} className="flex items-center gap-1 py-2 text-sm opacity-60"><ChevronLeft size={17}/>返回书影库</button>
      <div className={`mt-2 flex gap-4 rounded-2xl border p-4 ${panel}`}><div className="w-24 shrink-0 overflow-hidden rounded-xl"><Cover work={work}/></div><div className="relative min-w-0 flex-1 pr-8"><button onClick={shareWork} aria-label="分享到 Chat" title="分享到 Chat" className="absolute right-0 top-0 rounded-full p-1.5 opacity-40 hover:bg-current/5 hover:opacity-80"><Share2 size={14}/></button><p className="text-lg font-semibold">{work.title}</p>{work.original_title && <p className={`mt-1 text-xs ${muted}`}>{work.original_title}</p>}<p className={`mt-2 text-xs leading-5 ${muted}`}>{[work.creators.join(' / '), work.publisher, work.published_date || work.release_date, work.page_count ? `${work.page_count} 页` : '', work.runtime_minutes ? `${work.runtime_minutes} 分钟` : ''].filter(Boolean).join(' · ')}</p>{work.summary && <p className="mt-3 line-clamp-4 text-xs leading-5 opacity-70">{work.summary}</p>}</div></div>
      {message && <p role="status" className={`mt-3 rounded-xl px-3 py-2 text-xs ${message.includes('失败') ? 'bg-red-500/10 text-red-500' : muted}`}>{message}</p>}
      {work.kind === 'book' && (
        <CoreadPanel work={work} actor={actor} night={night} onChanged={onChanged} onOpen={() => setReaderOpen(true)}/>
      )}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className={`rounded-2xl border p-4 ${panel}`}><div className="flex items-center justify-between"><h2 className="text-sm font-medium">{icon(actor)} 我的记录</h2>{mine && <button aria-label="删除我的记录" onClick={() => setPendingDelete({ label: '删除你的记录、笔记和相关动态？另一人的内容不会受影响。', run: removeRecord })} className="p-1.5 opacity-45"><Trash2 size={15}/></button>}</div><select value={status} onChange={event => setStatus(event.target.value as MediaStatus)} className={`${input} mt-3`}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><div className="mt-3 flex gap-1" aria-label="评分">{[1,2,3,4,5].map(value => <button key={value} onClick={() => setRating(value === rating ? 0 : value)} aria-label={`${value}星`}><Star size={22} className={value <= rating ? 'fill-current text-[#c27a58]' : 'opacity-20'}/></button>)}</div><textarea value={review} onChange={event => setReview(event.target.value)} placeholder="写一句评价…" rows={4} className={`${input} mt-3 resize-none`}/><button disabled={busy} onClick={() => void saveRecord()} className={`mt-3 w-full rounded-xl py-2 text-sm ${night ? 'bg-night-surface text-night-amber' : 'bg-[#DBB9B3]/25 text-[#765953]'}`}>{busy ? '处理中…' : '保存我的记录'}</button></section>
        <section className={`rounded-2xl border p-4 ${panel}`}><h2 className="text-sm font-medium">两个人的状态</h2><div className="mt-3 space-y-3">{(['fire','star'] as MediaActor[]).map(who => { const record = work.records[who]; return <div key={who} className="flex items-start justify-between gap-3 text-sm"><span>{icon(who)} {person(who)}</span><span className={`text-right text-xs ${muted}`}>{record ? <>{STATUS[record.status]}{record.rating ? ` · ${record.rating}★` : ''}{record.review && <span className="mt-1 block max-w-48">“{record.review}”</span>}</> : '还没有记录'}</span></div>})}</div></section>
      </div>
      <section className={`mt-4 rounded-2xl border p-4 ${panel}`}><h2 className="text-sm font-medium">笔记与摘抄</h2><div className="mt-3 grid gap-2 sm:grid-cols-[110px_1fr]"><select value={noteType} onChange={event => setNoteType(event.target.value as MediaNoteType)} className={input}><option value="note">读书笔记</option><option value="quote">摘抄</option></select><input value={locator} onChange={event => setLocator(event.target.value)} placeholder={work.kind === 'book' ? '页码（可选）' : '集数 / 时间点（可选）'} className={input}/></div><textarea value={note} onChange={event => setNote(event.target.value)} placeholder="记下此刻想留住的内容…" rows={4} className={`${input} mt-2 resize-none`}/><button disabled={busy || !note.trim()} onClick={saveNote} className={`mt-2 rounded-xl px-4 py-2 text-sm ${night ? 'bg-night-surface text-night-amber' : 'bg-[#DBB9B3]/25 text-[#765953]'}`}>保存</button><div className="mt-4 space-y-2">{work.notes.slice().reverse().map(item => <div key={item.id} className="rounded-xl border border-current/10 p-3 text-sm"><div className={`flex items-center justify-between text-[11px] ${muted}`}><span>{icon(item.author)} {person(item.author)} · {item.type === 'quote' ? '摘抄' : '笔记'}{item.locator ? ` · ${item.locator}` : ''}</span>{item.author === actor && <button onClick={() => setPendingDelete({ label: '删除这条笔记？', run: () => run(async () => { await api.remove(actor, { type: 'note', work_id: work.id, note_id: item.id }); setPendingDelete(null); await onChanged() }, '笔记删除失败') })} className="p-1"><Trash2 size={13}/></button>}</div><p className="mt-2 whitespace-pre-wrap leading-6">{item.content}</p></div>)}</div></section>
      <section className="mt-4"><h2 className="mb-3 text-sm font-medium">这部作品的时间线</h2><div className="space-y-3">{work.events.slice().reverse().map(item => <EventCard key={item.id} item={{ ...item, work_id: work.id, work_title: work.title, work_kind: work.kind, cover_url: work.cover_url }} actor={actor} night={night} onChanged={onChanged}/>)}</div></section>
    </div>
    {pendingDelete && <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/45 p-5"><div role="alertdialog" aria-modal="true" className={`w-full max-w-sm rounded-2xl border p-5 ${panel}`}><p className="text-sm">{pendingDelete.label}</p><div className="mt-5 flex justify-end gap-2"><button onClick={() => setPendingDelete(null)} className="px-4 py-2 text-sm opacity-60">取消</button><button onClick={() => void pendingDelete.run()} className="rounded-xl bg-red-500/15 px-4 py-2 text-sm text-red-500">删除</button></div></div></div>}
  </div>
}

function CoreadPanel({ work, actor, night, onChanged, onOpen }: { work: MediaWork; actor: MediaActor; night: boolean; onChanged: () => Promise<void> | void; onOpen: () => void }) {
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [message, setMessage] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const panel = night ? 'border-night-border bg-night-card' : 'border-[#a73a32]/15 bg-[#fffaf5]/80'
  const request = async () => {
    setBusy(true); setMessage('')
    try { await api.save(actor, { work_id: work.id, status: work.records[actor]?.status || 'planned', coread_request: true }); await onChanged() }
    catch (err: any) { setMessage(err?.message || '开启共读失败') }
    setBusy(false)
  }
  const upload = async (file?: File) => {
    if (!file) return
    if (file.size > 30 * 1024 * 1024) { setMessage('文件不能超过 30MB'); return }
    setBusy(true); setMessage('正在整理正文，这可能需要一点时间…')
    try { await api.uploadCoread(actor, work.id, file); setMessage('已经放进共读书架'); await onChanged() }
    catch (err: any) { setMessage(err?.message || '文件读取失败') }
    setBusy(false)
  }
  return <section className={`mt-4 rounded-2xl border p-4 ${panel}`}><div className="flex items-center gap-2"><UsersRound size={16}/><h2 className="text-sm font-medium">和星星一起读</h2></div>{!work.coread ? <><p className="mt-2 text-xs leading-5 opacity-60">大部分书仍然只是收藏。只有真正想一起读的书，才会出现在轻量共读书架。</p><button disabled={busy} onClick={() => void request()} className={`mt-3 rounded-xl px-4 py-2 text-sm ${night ? 'bg-night-surface text-night-amber' : 'bg-[#DBB9B3]/25 text-[#765953]'}`}>放进共读书架</button></> : work.coread.status === 'ready' ? <><div className="mt-2 flex flex-wrap gap-2 text-xs opacity-60"><span>{work.coread.format?.toUpperCase()}</span><span>·</span><span>{work.coread.chapter_count} 章</span><span>·</span><span>{work.coread.paragraph_count} 段</span></div><button onClick={onOpen} className={`mt-3 w-full rounded-xl py-2.5 text-sm ${night ? 'bg-night-surface text-night-amber' : 'bg-[#DBB9B3]/25 text-[#765953]'}`}>继续共读</button></> : <><p className="mt-2 text-xs leading-5 opacity-60">{work.coread.requested_by === 'star' ? '星星想读这本书，等你帮他把文件带回来。' : '共读位置已经留好，把书拖进来就可以开始。'}{work.coread.request_note ? ` ${work.coread.request_note}` : ''}</p><input ref={fileRef} type="file" hidden accept=".epub,.pdf,.txt,application/epub+zip,application/pdf,text/plain" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void upload(file) }}/><button disabled={busy} onClick={() => fileRef.current?.click()} onDragEnter={event => { event.preventDefault(); setDragging(true) }} onDragOver={event => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); void upload(event.dataTransfer.files?.[0]) }} className={`mt-3 flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-6 text-xs ${dragging ? 'border-current bg-current/5' : 'border-current/20'}`}><FileUp size={20}/>{busy ? '正在整理正文…' : '拖入或选择 EPUB、PDF、TXT（最大 30MB）'}</button></>}{message && <p role="status" className={`mt-2 text-xs ${message.includes('失败') || message.includes('不能') ? 'text-red-500' : 'opacity-60'}`}>{message}</p>}</section>
}

function EventCard({ item, actor, night, onChanged }: { item: MediaTimelineItem; actor: MediaActor; night: boolean; onChanged: () => Promise<void> | void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const panel = night ? 'border-night-border bg-night-card' : 'border-[#a73a32]/15 bg-[#fffaf5]/80'
  const send = async () => {
    if (!draft.trim() || busy) return
    setBusy(true); setMessage('')
    try { await api.comment(actor, item.work_id, item.id, draft.trim()); setDraft(''); setOpen(true); await onChanged() }
    catch (err: any) { setMessage(err?.message || '评论发送失败') }
    finally { setBusy(false) }
  }
  return <article className={`rounded-2xl border p-3 ${panel}`}><div className="flex gap-3"><div className="pt-0.5 text-lg">{icon(item.actor)}</div><div className="min-w-0 flex-1"><p className="text-sm"><span className="font-medium">{person(item.actor)}</span> {EVENT[item.type]} <span className="font-medium">《{item.work_title}》</span></p>{item.detail && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-5 opacity-65">{item.detail}</p>}<div className="mt-2 flex items-center gap-3 text-[11px] opacity-45"><span>{when(item.created_at)}</span><button onClick={() => setOpen(value => !value)} className="flex items-center gap-1"><MessageCircle size={12}/>{item.comments.length || '评论'}</button></div>{open && <div className="mt-3 space-y-2 border-t border-current/10 pt-3">{item.comments.map(comment => <p key={comment.id} className="text-xs"><span className="font-medium">{icon(comment.author)} {person(comment.author)}</span>：{comment.content}</p>)}<div className="flex gap-2"><input value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void send() }} placeholder="回应这条动态…" className="min-w-0 flex-1 rounded-lg border border-current/10 bg-transparent px-2 py-1.5 text-xs outline-none"/><button disabled={busy || !draft.trim()} onClick={() => void send()} className="px-2 text-xs opacity-70 disabled:opacity-25">{busy ? '发送中…' : '发送'}</button></div>{message && <p role="alert" className="text-xs text-red-500">{message}</p>}</div>}</div></div></article>
}
