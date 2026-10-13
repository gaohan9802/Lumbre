'use client'

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, Check, Expand, MapPin, Minimize2, Minus, Pencil, Plus, RotateCcw, Search, Share2, Trash2, Users, X } from 'lucide-react'
import { travelVisits as travelApi } from '@/lib/api'
import { formatMadridShort, madridDateKey } from '@/lib/madrid-time'
import { groupTravelVisits, projectTravelPoint, type TravelCompanion, type TravelJournalEntry, type TravelMapView as MapView, type TravelPlaceGroup, type TravelPlaceResult, type TravelVisit } from '@/lib/travel-map'
import { shareToChat } from '@/lib/share'

interface Album { id: string; name: string }
interface Props { isNight: boolean; albums: Album[]; onOpenAlbum: (id: string) => void }

const VIEW_LABELS: Record<MapView, string> = { all: '全部足迹', solo: '独自出发', star: '和星星' }
const COMPANION_LABELS: Record<TravelCompanion, string> = { solo: '独自', star: '和星星', other: '有同行人' }
const blankDraft = () => ({
  id: '', place_id: '', place_name: '', address: '', lat: 0, lon: 0,
  start_date: madridDateKey(), end_date: '', companion: 'solo' as TravelCompanion,
  companion_name: '', note: '', album_id: '',
})

function dateLabel(visit: TravelVisit) {
  return visit.end_date && visit.end_date !== visit.start_date ? `${visit.start_date} — ${visit.end_date}` : visit.start_date
}
function journalLabel(entry: TravelJournalEntry) {
  try { return formatMadridShort(entry.created_at) } catch { return '' }
}

export function TravelMapView({ isNight, albums, onOpenAlbum }: Props) {
  const [visits, setVisits] = useState<TravelVisit[]>([])
  const [view, setView] = useState<MapView>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [focus, setFocus] = useState({ x: 50, y: 50 })
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [draft, setDraft] = useState(blankDraft)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TravelPlaceResult[]>([])
  const [searching, setSearching] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [journalDrafts, setJournalDrafts] = useState<Record<string, string>>({})

  const load = async () => {
    setLoading(true); setError('')
    try { const data = await travelApi.list(); setVisits(data.visits || []) }
    catch (err) { setError(err instanceof Error ? err.message : '旅行足迹没有加载成功') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!expanded) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false) }
    window.addEventListener('keydown', close)
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', close) }
  }, [expanded])

  const groups = useMemo(() => groupTravelVisits(visits, view), [visits, view])
  const selected = groups.find(group => group.place_id === selectedId) || null
  useEffect(() => { if (selectedId && !groups.some(group => group.place_id === selectedId)) setSelectedId(null) }, [groups, selectedId])

  const focusGroup = (group: TravelPlaceGroup) => {
    const point = projectTravelPoint(group.lat, group.lon)
    setSelectedId(group.place_id); setFocus(point); setZoom(current => Math.max(current, expanded ? 4 : 2))
  }
  const resetMap = () => { setZoom(1); setFocus({ x: 50, y: 50 }); setSelectedId(null) }
  const openNew = () => { setDraft(blankDraft()); setQuery(''); setResults([]); setFormOpen(true); setError('') }
  const openEdit = (visit: TravelVisit) => {
    setDraft({ ...visit, end_date: visit.end_date || '', album_id: visit.album_id || '' })
    setQuery(visit.address); setResults([]); setFormOpen(true); setError('')
  }
  const searchPlace = async () => {
    if (query.trim().length < 2) return setError('请至少输入两个字来查找地点')
    setSearching(true); setError(''); setResults([])
    try { const data = await travelApi.search(query.trim()); setResults(data.results || []) }
    catch (err) { setError(err instanceof Error ? err.message : '地点没有查到') }
    finally { setSearching(false) }
  }
  const choosePlace = (place: TravelPlaceResult) => {
    setDraft(current => ({ ...current, place_id: place.place_id, place_name: place.name, address: place.address, lat: place.lat, lon: place.lon }))
    setQuery(place.address); setResults([])
  }
  const save = async (continueAdding = false) => {
    if (!draft.place_id) return setError('请先查找并选择一个地点')
    setBusy(true); setError('')
    try {
      const savedPlaceId = draft.place_id
      await travelApi.save(draft)
      await load(); setSelectedId(savedPlaceId)
      if (continueAdding) {
        const next = blankDraft()
        setDraft({ ...next, start_date: draft.start_date, end_date: draft.end_date, companion: draft.companion, companion_name: draft.companion_name, album_id: draft.album_id })
        setQuery(''); setResults([])
      } else setFormOpen(false)
    } catch (err) { setError(err instanceof Error ? err.message : '旅行足迹没有保存成功') }
    finally { setBusy(false) }
  }
  const remove = async (id: string) => {
    setBusy(true); setError('')
    try { await travelApi.remove(id); setDeleteId(null); await load() }
    catch (err) { setError(err instanceof Error ? err.message : '删除失败') }
    finally { setBusy(false) }
  }
  const appendJournal = async (id: string) => {
    const content = journalDrafts[id]?.trim()
    if (!content) return
    setBusy(true); setError('')
    try {
      await travelApi.appendJournal(id, content)
      setJournalDrafts(current => ({ ...current, [id]: '' }))
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : '旅行日记没有保存成功') }
    finally { setBusy(false) }
  }
  const shareVisit = (visit: TravelVisit) => {
    const journal = visit.journal || []
    shareToChat({
      kind: 'travel-visit', title: `🧭 ${visit.place_name}`,
      subtitle: `${dateLabel(visit)} · ${visit.companion === 'other' ? visit.companion_name : COMPANION_LABELS[visit.companion]}`,
      body: [visit.note, ...journal.map(entry => `${entry.author === 'fire' ? '🦦' : '🐆'} ${entry.content}`)].filter(Boolean).join('\n\n') || '这次旅行还没有写下日记。',
      metadata: { ...visit },
    })
  }
  const shareMap = () => shareToChat({
    kind: 'travel-map', title: `🗺️ ${VIEW_LABELS[view]}`,
    subtitle: `${groups.length} 个地点 · ${groups.reduce((sum, group) => sum + group.visits.length, 0)} 次旅行`,
    body: groups.length ? groups.slice(0, 10).map(group => `${group.name}${group.visits.length > 1 ? ` ×${group.visits.length}` : ''}`).join(' · ') : '这张地图还没有留下足迹。',
    metadata: {
      view, places: groups.map(group => ({
        place_id: group.place_id, name: group.name, address: group.address, lat: group.lat, lon: group.lon,
        visits: group.visits.map(visit => ({
          id: visit.id, start_date: visit.start_date, end_date: visit.end_date,
          companion: visit.companion, companion_name: visit.companion_name,
          note: visit.note, journal: visit.journal, album_id: visit.album_id,
        })),
      })),
    },
  })

  const mapPanel = <div className={expanded ? 'fixed inset-0 z-[90] bg-black/55 p-2 pt-[max(env(safe-area-inset-top),0.5rem)] backdrop-blur-sm' : ''}>
    <div role={expanded ? 'dialog' : undefined} aria-modal={expanded || undefined} aria-label={expanded ? '放大的旅行地图' : undefined} className={`relative overflow-hidden border ${expanded ? 'h-full w-full rounded-3xl' : 'aspect-[2/1] rounded-2xl'} ${isNight ? 'border-night-border/60 bg-night-surface' : 'border-[#8d5e55]/10 bg-[#f3efeb]'}`}>
      {expanded && <div className={`absolute inset-x-0 top-0 z-20 flex h-11 items-center gap-2 border-b px-3 ${isNight ? 'border-night-border/60 bg-night-card/95' : 'border-[#8d5e55]/10 bg-white/95'}`}>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{selected?.name || VIEW_LABELS[view]}</span>
        <button onClick={resetMap} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] opacity-55 hover:opacity-100"><RotateCcw size={11}/>回到世界</button>
        <button onClick={() => setExpanded(false)} aria-label="收起地图" className="grid h-7 w-7 place-items-center rounded-full opacity-55 hover:opacity-100"><Minimize2 size={13}/></button>
      </div>}
      <div className={`absolute inset-x-0 bottom-0 overflow-hidden ${expanded ? 'top-11' : 'top-0'}`}>
        <div className="absolute left-1/2 top-1/2 aspect-[2/1] w-full -translate-x-1/2 -translate-y-1/2">
          <div className="absolute inset-0 transition-transform duration-500 ease-out" style={{ transform: `scale(${zoom})`, transformOrigin: `${focus.x}% ${focus.y}%` }}>
            <img src="/maps/world-land.svg" alt="" draggable={false} aria-hidden="true" className={`absolute inset-0 h-full w-full select-none object-contain ${isNight ? 'opacity-45 brightness-75' : 'opacity-55'}`}/>
            {groups.map(group => {
              const point = projectTravelPoint(group.lat, group.lon)
              const count = group.visits.length
              const size = 10 + Math.min(count - 1, 4) * 2
              const selectedPoint = selectedId === group.place_id
              const opacity = Math.min(.52 + count * .12, .98)
              return <button key={group.place_id} onClick={() => focusGroup(group)} aria-label={`${group.name}，去过${count}次`} title={`${group.name} · ${count} 次`} className="absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-white transition" style={{ left: `${point.x}%`, top: `${point.y}%`, width: size / zoom, height: size / zoom, fontSize: 6 / zoom, backgroundColor: `rgba(183, 91, 83, ${opacity})`, boxShadow: selectedPoint ? `0 0 0 ${2 / zoom}px rgba(255,255,255,.95), 0 0 ${12 / zoom}px rgba(183,91,83,.85)` : `0 0 ${7 / zoom}px rgba(183,91,83,.55)` }}>{count > 1 ? count : ''}</button>
            })}
          </div>
        </div>
        {selected && !expanded && <div className={`absolute left-2 top-2 max-w-[60%] truncate rounded-full px-2.5 py-1 text-[9px] shadow-sm backdrop-blur ${isNight ? 'bg-night-card/85' : 'bg-white/85'}`}><MapPin size={9} className="mr-1 inline"/>{selected.name}</div>}
        <div className="absolute bottom-2 right-2 flex gap-1">
          <button onClick={resetMap} aria-label="回到世界地图" title="回到世界" className={`grid h-7 w-7 place-items-center rounded-full backdrop-blur ${isNight ? 'bg-night-card/80' : 'bg-white/80'}`}><RotateCcw size={11}/></button>
          <button onClick={() => setZoom(value => Math.max(1, value / 2))} aria-label="缩小地图" className={`grid h-7 w-7 place-items-center rounded-full backdrop-blur ${isNight ? 'bg-night-card/80' : 'bg-white/80'}`}><Minus size={12}/></button>
          <button onClick={() => setZoom(value => Math.min(8, value * 2))} aria-label="放大地图" className={`grid h-7 w-7 place-items-center rounded-full backdrop-blur ${isNight ? 'bg-night-card/80' : 'bg-white/80'}`}><Plus size={12}/></button>
          {!expanded && <button onClick={() => setExpanded(true)} aria-label="放大旅行地图" title="全屏地图" className={`grid h-7 w-7 place-items-center rounded-full backdrop-blur ${isNight ? 'bg-night-card/80' : 'bg-white/80'}`}><Expand size={12}/></button>}
        </div>
        {!loading && !groups.length && <div className="absolute inset-0 grid place-items-center"><div className="rounded-xl bg-black/20 px-3 py-2 text-[10px] text-white backdrop-blur">这张地图还没有足迹</div></div>}
      </div>
    </div>
  </div>

  return <div className="space-y-3">
    <div className="flex items-center gap-2">
      <div className={`flex min-w-0 flex-1 rounded-xl p-1 ${isNight ? 'bg-night-surface' : 'bg-[#DBB9B3]/14'}`}>
        {(Object.keys(VIEW_LABELS) as MapView[]).map(key => <button key={key} onClick={() => setView(key)} className={`flex-1 rounded-lg px-2 py-1.5 text-[10px] transition ${view === key ? (isNight ? 'bg-night-card text-night-amber' : 'bg-white/75 text-[#765953] shadow-sm') : 'opacity-45'}`}>{VIEW_LABELS[key]}</button>)}
      </div>
      <button onClick={shareMap} aria-label="分享旅行地图到 Chat" title="分享到 Chat" className="grid h-8 w-8 shrink-0 place-items-center rounded-full opacity-55 hover:opacity-100"><Share2 size={14}/></button>
      <button onClick={openNew} className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-xl px-2.5 text-[10px] ${isNight ? 'bg-night-amber/20 text-night-amber' : 'chat-dialog-accent'}`}><Plus size={12}/>足迹</button>
    </div>

    {error && !formOpen && <div role="alert" className="flex items-center justify-between px-2 text-xs text-red-500"><span>{error}</span><button onClick={() => void load()} className="underline">重试</button></div>}

    {expanded ? createPortal(mapPanel, document.body) : mapPanel}
    <div className="flex items-center justify-between px-1 text-[8px] opacity-35"><span>{loading ? '正在展开地图…' : `${groups.length} 个地点`}</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">地点资料 © OpenStreetMap</a></div>

    {!!groups.length && <div className="flex gap-1.5 overflow-x-auto pb-1">
      {groups.map(group => <button key={group.place_id} onClick={() => focusGroup(group)} className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] ${selectedId === group.place_id ? (isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-[#DBB9B3]/30') : 'opacity-45'}`}><MapPin size={9} className="mr-1 inline"/>{group.name}{group.visits.length > 1 ? ` ×${group.visits.length}` : ''}</button>)}
    </div>}

    {selected && <div className={`rounded-2xl p-3 ${isNight ? 'bg-night-surface' : 'chat-dialog-card'}`}>
      <div className="mb-2"><h3 className="text-sm font-medium">{selected.name}</h3><p className="mt-0.5 line-clamp-2 text-[9px] opacity-40">{selected.address}</p></div>
      <div className="space-y-2">{selected.visits.map(visit => <div key={visit.id} className={`rounded-xl p-2.5 ${isNight ? 'bg-night-card' : 'bg-white/55'}`}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1"><p className="flex items-center gap-1 text-[10px]"><CalendarDays size={10}/>{dateLabel(visit)}</p><p className="mt-1 flex items-center gap-1 text-[9px] opacity-45"><Users size={9}/>{visit.companion === 'other' ? visit.companion_name : COMPANION_LABELS[visit.companion]}</p>{visit.note && <p className="mt-1.5 whitespace-pre-wrap text-xs opacity-75">{visit.note}</p>}</div>
          <button onClick={() => shareVisit(visit)} aria-label="分享这次旅行到 Chat" title="分享到 Chat" className="p-1 opacity-40"><Share2 size={11}/></button>
          <button onClick={() => openEdit(visit)} aria-label="编辑旅行记录" className="p-1 opacity-40"><Pencil size={11}/></button>
          <button onClick={() => setDeleteId(visit.id)} aria-label="删除旅行记录" className="p-1 text-red-400/70"><Trash2 size={11}/></button>
        </div>
        {visit.album_id && albums.some(album => album.id === visit.album_id) && <button onClick={() => onOpenAlbum(visit.album_id!)} className="mt-2 text-[9px] text-[#a45f57] underline underline-offset-2">打开相册 · {albums.find(album => album.id === visit.album_id)?.name}</button>}
        <div className={`mt-2 rounded-xl p-2 ${isNight ? 'bg-night-surface/70' : 'bg-[#DBB9B3]/10'}`}>
          <p className="mb-1.5 text-[9px] font-medium opacity-45">旅行小日记</p>
          {!!visit.journal?.length && <div className="mb-2 space-y-1.5">{visit.journal.map(entry => <div key={entry.id} className="flex items-start gap-1.5 text-[10px]"><span aria-label={entry.author === 'fire' ? '小火' : '星星'}>{entry.author === 'fire' ? '🦦' : '🐆'}</span><div className="min-w-0 flex-1"><p className="whitespace-pre-wrap leading-relaxed">{entry.content}</p><p className="mt-0.5 text-[8px] opacity-30">{journalLabel(entry)}</p></div></div>)}</div>}
          <div className="flex items-end gap-1.5"><textarea value={journalDrafts[visit.id] || ''} onChange={event => setJournalDrafts(current => ({ ...current, [visit.id]: event.target.value }))} placeholder="续写这一程…" rows={2} maxLength={2000} className={`min-w-0 flex-1 resize-none rounded-lg px-2 py-1.5 text-[10px] outline-none ${isNight ? 'bg-night-card' : 'bg-white/70'}`}/><button onClick={() => void appendJournal(visit.id)} disabled={busy || !journalDrafts[visit.id]?.trim()} className="shrink-0 rounded-lg px-2 py-1.5 text-[9px] opacity-65 disabled:opacity-25">续写</button></div>
        </div>
        {deleteId === visit.id && <div className="mt-2 flex items-center justify-end gap-2 text-[9px]"><span className="mr-auto opacity-45">确定删除这次旅行？</span><button onClick={() => setDeleteId(null)}>取消</button><button disabled={busy} onClick={() => void remove(visit.id)} className="text-red-500">删除</button></div>}
      </div>)}</div>
    </div>}

    {formOpen && <div className="fixed inset-0 z-[85] flex items-end justify-center bg-black/45 backdrop-blur-sm sm:items-center" onMouseDown={event => { if (event.target === event.currentTarget) setFormOpen(false) }}>
      <div role="dialog" aria-modal="true" aria-label={draft.id ? '编辑旅行足迹' : '添加旅行足迹'} className={`max-h-[88dvh] w-full max-w-md overflow-y-auto rounded-t-2xl p-4 sm:rounded-2xl ${isNight ? 'bg-night-card text-night-text' : 'chat-dialog text-[#3f2c29]'}`}>
        <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-medium">{draft.id ? '编辑旅行足迹' : '点亮一个地方'}</h3><button onClick={() => setFormOpen(false)} className="p-1 opacity-45"><X size={15}/></button></div>
        <div className="space-y-3">
          <div><label className="mb-1 block text-[10px] opacity-45">地点或地址</label><div className={`flex gap-1.5 rounded-xl p-1.5 ${isNight ? 'bg-night-surface' : 'chat-dialog-field'}`}><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => event.key === 'Enter' && void searchPlace()} placeholder="例如：马德里丽池公园" className="min-w-0 flex-1 bg-transparent px-1 text-xs outline-none"/><button onClick={() => void searchPlace()} disabled={searching} className="grid h-7 w-7 place-items-center rounded-lg opacity-60 disabled:opacity-25"><Search size={13}/></button></div></div>
          {!!results.length && <div className={`rounded-xl p-1 ${isNight ? 'bg-night-surface' : 'bg-[#DBB9B3]/12'}`}>{results.map(place => <button key={place.place_id} onClick={() => choosePlace(place)} className="flex w-full items-start gap-2 rounded-lg p-2 text-left hover:bg-black/5"><MapPin size={12} className="mt-0.5 shrink-0"/><span><span className="block text-xs">{place.name}</span><span className="mt-0.5 block line-clamp-2 text-[9px] opacity-40">{place.address}</span></span></button>)}</div>}
          {draft.place_id && <div className={`flex items-start gap-2 rounded-xl p-2.5 text-xs ${isNight ? 'bg-night-amber/10' : 'bg-[#DBB9B3]/18'}`}><Check size={12} className="mt-0.5 shrink-0"/><span><span className="block">{draft.place_name}</span><span className="mt-0.5 block text-[9px] opacity-45">{draft.address}</span></span></div>}

          <div className="grid grid-cols-2 gap-2"><label className="text-[10px] opacity-55">开始日期<input type="date" value={draft.start_date} onChange={event => setDraft(current => ({ ...current, start_date: event.target.value }))} className={`mt-1 w-full rounded-xl p-2 text-xs outline-none ${isNight ? 'bg-night-surface' : 'chat-dialog-field'}`}/></label><label className="text-[10px] opacity-55">结束日期（可空）<input type="date" value={draft.end_date} onChange={event => setDraft(current => ({ ...current, end_date: event.target.value }))} className={`mt-1 w-full rounded-xl p-2 text-xs outline-none ${isNight ? 'bg-night-surface' : 'chat-dialog-field'}`}/></label></div>

          <div><label className="mb-1 block text-[10px] opacity-45">同行方式</label><div className={`grid grid-cols-3 gap-1 rounded-xl p-1 ${isNight ? 'bg-night-surface' : 'bg-[#DBB9B3]/12'}`}>{(['solo', 'star', 'other'] as TravelCompanion[]).map(companion => <button key={companion} onClick={() => setDraft(current => ({ ...current, companion }))} className={`rounded-lg py-2 text-[10px] ${draft.companion === companion ? (isNight ? 'bg-night-card text-night-amber' : 'bg-white/75 shadow-sm') : 'opacity-45'}`}>{COMPANION_LABELS[companion]}</button>)}</div></div>
          {draft.companion === 'other' && <input value={draft.companion_name} onChange={event => setDraft(current => ({ ...current, companion_name: event.target.value }))} placeholder="同行人的名字" className={`w-full rounded-xl p-2.5 text-xs outline-none ${isNight ? 'bg-night-surface' : 'chat-dialog-field'}`}/>}
          <select value={draft.album_id} onChange={event => setDraft(current => ({ ...current, album_id: event.target.value }))} className={`w-full rounded-xl p-2.5 text-xs outline-none ${isNight ? 'bg-night-surface' : 'chat-dialog-field'}`}><option value="">不关联相册</option>{albums.map(album => <option key={album.id} value={album.id}>关联 · {album.name}</option>)}</select>
          <textarea value={draft.note} onChange={event => setDraft(current => ({ ...current, note: event.target.value }))} placeholder="留一句旅行记忆（可空）" rows={3} className={`w-full resize-none rounded-xl p-2.5 text-xs outline-none ${isNight ? 'bg-night-surface' : 'chat-dialog-field'}`}/>
          {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
          <div className={`grid gap-2 ${draft.id ? 'grid-cols-1' : 'grid-cols-2'}`}>
            {!draft.id && <button onClick={() => void save(true)} disabled={busy || searching} className={`rounded-xl py-2.5 text-xs disabled:opacity-30 ${isNight ? 'bg-night-surface' : 'chat-dialog-field'}`}>保存并继续</button>}
            <button onClick={() => void save()} disabled={busy || searching} className={`rounded-xl py-2.5 text-xs disabled:opacity-30 ${isNight ? 'bg-night-amber/20 text-night-amber' : 'chat-dialog-accent'}`}>{busy ? '正在保存…' : '保存足迹'}</button>
          </div>
        </div>
      </div>
    </div>}
  </div>
}
