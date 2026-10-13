'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import dynamic from 'next/dynamic'
import { Camera, Check, FolderPlus, Images, Lock, MapPin, MessageCircle, Pencil, Plus, Send, Share2, Trash2, X } from 'lucide-react'
import { photos as photosApi } from '@/lib/api'
import { compressImage } from '@/lib/image'
import { formatMadridShort } from '@/lib/madrid-time'
import { shareToChat } from '@/lib/share'
import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'

const TravelMapView = dynamic(() => import('./TravelMapView').then(module => module.TravelMapView), { ssr: false })

type PhotoZone = 'wall' | 'travel' | 'locked'
interface PhotoComment { author: string; content: string; time: string }
interface PhotoAlbum { id: string; name: string; zone: PhotoZone; built_in?: boolean }
interface PhotoEntry {
  id: string; author: string; url: string; thumbnail_url: string; caption: string
  zone: PhotoZone; album_id: string; locked?: boolean; comments: PhotoComment[]
  created_at: string; updated_at: string | null; source?: string
}

const ZONES: Array<{ id: PhotoZone; label: string; icon: typeof Images }> = [
  { id: 'wall', label: '照片墙', icon: Images },
  { id: 'travel', label: '旅行', icon: MapPin },
  { id: 'locked', label: '上锁', icon: Lock },
]
const emojiFor = (author: string) => author === 'fire' ? '🦦' : '🐆'
const fmt = (ts: string) => { try { return formatMadridShort(ts) } catch { return '' } }

export function PhotosView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const { currentUser } = useApp()
  const fileRef = useRef<HTMLInputElement>(null)
  const [zone, setZone] = useState<PhotoZone>('wall')
  const [travelPage, setTravelPage] = useState<'photos' | 'map'>('photos')
  const [albums, setAlbums] = useState<PhotoAlbum[]>([])
  const [albumId, setAlbumId] = useState<string | null>(null)
  const [items, setItems] = useState<PhotoEntry[]>([])
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [active, setActive] = useState<PhotoEntry | null>(null)
  const [editingCaption, setEditingCaption] = useState(false)
  const [captionDraft, setCaptionDraft] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [hasPassword, setHasPassword] = useState<boolean | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [settingPassword, setSettingPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')

  const lockedOut = zone === 'locked' && hasPassword === true && !unlocked

  const loadAlbums = useCallback(async (nextZone: PhotoZone) => {
    const data = await photosApi.albums(nextZone)
    setAlbums(data.albums || [])
  }, [])

  const load = useCallback(async (append = false, cursor?: string) => {
    if (lockedOut) { setLoading(false); return }
    setLoading(true)
    setError('')
    try {
      const data = await photosApi.list({ zone, album_id: albumId || undefined, cursor, limit: 24 })
      setItems(previous => append ? [...previous, ...(data.photos || [])] : (data.photos || []))
      setNextCursor(data.next_cursor || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '照片没有加载成功')
    } finally { setLoading(false) }
  }, [albumId, lockedOut, zone])

  useEffect(() => {
    photosApi.password('check').then(result => setHasPassword(result.hasPassword)).catch(() => setHasPassword(false))
  }, [])
  useEffect(() => { setAlbumId(null); setItems([]); void loadAlbums(zone).catch(() => setError('专辑没有加载成功')) }, [loadAlbums, zone])
  useEffect(() => { if (hasPassword !== null) void load() }, [hasPassword, load])
  useEffect(() => {
    if (!active) return
    const fresh = items.find(photo => photo.id === active.id)
    if (fresh) setActive(fresh)
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps

  const sharePhoto = (photo: PhotoEntry) => shareToChat({
    kind: 'photo', title: '📷 照片', subtitle: `${emojiFor(photo.author)} · ${fmt(photo.created_at)}`,
    body: photo.caption, imageUrl: photo.url, metadata: { ...photo },
  })
  const shareAlbum = async (album: PhotoAlbum) => {
    setBusy(true); setError('')
    try {
      const data = await photosApi.albumShare(album.id)
      const photos = (data.photos || []) as Array<Pick<PhotoEntry, 'id' | 'author' | 'caption' | 'created_at' | 'url'>>
      shareToChat({
        kind: 'photo-album', title: `🖼️ ${album.name}`,
        subtitle: `${ZONES.find(item => item.id === album.zone)?.label || '相册'} · ${data.photo_count || 0} 张`,
        body: photos.length ? photos.slice(0, 8).map((photo, index) => `${index + 1}. ${photo.caption || '无说明'} ${emojiFor(photo.author)}`).join('\n') : '这本相册还是空的。',
        imageUrl: photos[0]?.url,
        metadata: {
          album: { id: album.id, name: album.name, zone: album.zone },
          photo_count: data.photo_count || 0,
          photos: photos.map(photo => ({ id: photo.id, author: photo.author, caption: photo.caption, created_at: photo.created_at })),
        },
      })
    } catch (err) { setError(err instanceof Error ? err.message : '分享相册失败') }
    finally { setBusy(false) }
  }

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const targetAlbum = albumId || albums[0]?.id
    if (!targetAlbum) return setError('请先建一个专辑')
    setBusy(true); setError('')
    try {
      const raw = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(new Error('读取照片失败'))
        reader.readAsDataURL(file)
      })
      await photosApi.write(currentUser, await compressImage(raw, 2400, 0.88), '', 'upload', zone === 'locked', targetAlbum, zone)
      await load()
    } catch (err) { setError(err instanceof Error ? err.message : '上传失败') }
    finally { setBusy(false) }
  }

  const createAlbum = async () => {
    const name = window.prompt('给新专辑起个名字')?.trim()
    if (!name) return
    try {
      const result = await photosApi.createAlbum(name, zone)
      await loadAlbums(zone)
      setAlbumId(result.album.id)
    } catch (err) { setError(err instanceof Error ? err.message : '建立专辑失败') }
  }
  const renameAlbum = async (album: PhotoAlbum) => {
    const name = window.prompt('修改专辑名', album.name)?.trim()
    if (!name || name === album.name) return
    try { await photosApi.renameAlbum(album.id, name); await loadAlbums(zone) }
    catch (err) { setError(err instanceof Error ? err.message : '修改失败') }
  }
  const deleteAlbum = async (album: PhotoAlbum) => {
    if (!window.confirm(`删除空专辑“${album.name}”？`)) return
    try { await photosApi.deleteAlbum(album.id); if (albumId === album.id) setAlbumId(null); await loadAlbums(zone) }
    catch { setError('专辑里还有照片，先把照片移走才能删除') }
  }
  const saveCaption = async () => {
    if (!active) return
    setBusy(true)
    try { await photosApi.edit(active.id, captionDraft); setEditingCaption(false); await load() }
    finally { setBusy(false) }
  }
  const movePhoto = async (nextAlbumId: string) => {
    if (!active) return
    const target = allAlbums.find(album => album.id === nextAlbumId)
    if (!target) return
    setBusy(true)
    try {
      await photosApi.edit(active.id, undefined, undefined, nextAlbumId)
      setActive(null)
      if (target.zone !== zone) setZone(target.zone)
      else await load()
    } finally { setBusy(false) }
  }
  const remove = async (id: string) => {
    setBusy(true)
    try { await photosApi.delete(id); setActive(null); setDeleteConfirm(null); await load() }
    finally { setBusy(false) }
  }
  const addComment = async () => {
    if (!active || !commentDraft.trim()) return
    setBusy(true)
    try { await photosApi.comment(active.id, currentUser, commentDraft.trim()); setCommentDraft(''); await load() }
    finally { setBusy(false) }
  }
  const verifyPassword = async () => {
    setPasswordError('')
    const result = await photosApi.password('verify', passwordInput)
    if (result.ok) { setUnlocked(true); setPasswordInput('') } else setPasswordError('密码错误')
  }
  const savePassword = async () => {
    if (!newPassword.trim()) return
    await photosApi.password('set', newPassword.trim())
    setHasPassword(true); setUnlocked(true); setSettingPassword(false); setNewPassword('')
  }

  const [allAlbums, setAllAlbums] = useState<PhotoAlbum[]>([])
  useEffect(() => { photosApi.albums().then(data => setAllAlbums(data.albums || [])).catch(() => {}) }, [albums])
  const selectedAlbum = albums.find(album => album.id === albumId)
  const mapActive = zone === 'travel' && travelPage === 'map'

  return (
    <div className={`h-full overflow-y-auto ${isNight ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
      <div className="max-w-lg mx-auto px-4 py-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-xl font-medium"><Camera size={17} strokeWidth={1.5}/>我们的相册</h2>
          {!mapActive && <button onClick={() => fileRef.current?.click()} disabled={busy || lockedOut}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs disabled:opacity-30 ${isNight ? 'bg-night-amber/20 text-night-amber' : 'chat-dialog-accent'}`}>
            <Plus size={13}/>{busy ? '收进去…' : '收藏照片'}
          </button>}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile}/>
        </div>

        <div className={`grid grid-cols-3 gap-1 p-1 rounded-xl ${isNight ? 'bg-night-surface' : 'bg-[#DBB9B3]/14'}`}>
          {ZONES.map(tab => {
            const Icon = tab.icon
            return <button key={tab.id} onClick={() => setZone(tab.id)} className={`flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs transition ${zone === tab.id ? (isNight ? 'bg-night-card text-night-amber' : 'bg-white/70 text-[#765953] shadow-sm') : 'opacity-45'}`}><Icon size={12}/>{tab.label}</button>
          })}
        </div>

        {zone === 'travel' && <div className={`mx-auto grid w-40 grid-cols-2 gap-1 rounded-xl p-1 ${isNight ? 'bg-night-surface' : 'bg-[#DBB9B3]/14'}`}><button onClick={() => setTravelPage('photos')} className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] ${travelPage === 'photos' ? (isNight ? 'bg-night-card text-night-amber' : 'bg-white/75 shadow-sm') : 'opacity-40'}`}><Images size={11}/>相册</button><button onClick={() => setTravelPage('map')} className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] ${travelPage === 'map' ? (isNight ? 'bg-night-card text-night-amber' : 'bg-white/75 shadow-sm') : 'opacity-40'}`}><MapPin size={11}/>地图</button></div>}

        {mapActive ? <TravelMapView isNight={isNight} albums={albums} onOpenAlbum={id => { setAlbumId(id); setTravelPage('photos') }}/> : <>
        <div className="flex gap-1.5 overflow-x-auto pb-1 items-center">
          <button onClick={() => setAlbumId(null)} className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] ${albumId === null ? (isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-[#DBB9B3]/30') : 'opacity-45'}`}>全部</button>
          {albums.map(album => <div key={album.id} className="group relative shrink-0">
            <button onClick={() => setAlbumId(album.id)} onDoubleClick={() => renameAlbum(album)}
              className={`px-3 py-1.5 rounded-full text-[11px] ${albumId === album.id ? (isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-[#DBB9B3]/30') : 'opacity-55'}`}>{album.name}</button>
            {albumId === album.id && <span className="absolute -right-2 -top-2 flex gap-0.5">
              <button aria-label={`重命名${album.name}`} onClick={() => renameAlbum(album)} className={`rounded-full p-1 ${isNight ? 'bg-night-card' : 'bg-white'}`}><Pencil size={8}/></button>
              {!album.built_in && <button aria-label={`删除${album.name}`} onClick={() => deleteAlbum(album)} className="rounded-full bg-red-400 text-white p-1"><X size={8}/></button>}
            </span>}
          </div>)}
          <button onClick={createAlbum} className="shrink-0 p-1.5 rounded-full opacity-45 hover:opacity-100" title="新建专辑"><FolderPlus size={14}/></button>
          {selectedAlbum && !lockedOut && <button onClick={() => void shareAlbum(selectedAlbum)} disabled={busy} aria-label={`分享${selectedAlbum.name}到 Chat`} title="分享整本相册到 Chat" className="shrink-0 p-1.5 rounded-full opacity-45 hover:opacity-100 disabled:opacity-20"><Share2 size={13}/></button>}
          {zone === 'locked' && <button onClick={() => setSettingPassword(true)} className="ml-auto shrink-0 text-[10px] opacity-40">{hasPassword ? '改密码' : '设密码'}</button>}
        </div>

        {settingPassword && <div className={`p-3 rounded-xl flex gap-2 ${isNight ? 'bg-night-surface' : 'chat-dialog-card'}`}>
          <input value={newPassword} onChange={event => setNewPassword(event.target.value)} type="password" placeholder="新密码" className={`min-w-0 flex-1 text-sm p-2 rounded-lg outline-none ${isNight ? 'bg-night-card' : 'chat-dialog-field'}`}/>
          <button onClick={savePassword} className="text-xs">保存</button><button onClick={() => setSettingPassword(false)} className="text-xs opacity-40">取消</button>
        </div>}

        {error && <div role="alert" className="flex justify-between items-center text-xs text-red-500 px-2"><span>{error}</span><button onClick={() => load()} className="underline">重试</button></div>}

        {lockedOut ? <div className={`p-7 rounded-2xl text-center ${isNight ? 'bg-night-surface' : 'chat-dialog-card'}`}>
          <Lock size={28} className="mx-auto mb-3 opacity-20"/><p className="text-sm mb-4">这一格要先解锁</p>
          <div className="flex gap-2 max-w-xs mx-auto"><input value={passwordInput} onChange={event => { setPasswordInput(event.target.value); setPasswordError('') }} onKeyDown={event => event.key === 'Enter' && void verifyPassword()} type="password" placeholder="密码" className={`min-w-0 flex-1 text-sm p-2 rounded-lg outline-none ${isNight ? 'bg-night-card' : 'chat-dialog-field'}`}/><button onClick={verifyPassword} className="px-3 text-xs">解锁</button></div>
          {passwordError && <p className="mt-2 text-xs text-red-500">{passwordError}</p>}
        </div> : <>
          {loading && !items.length ? <div className="grid grid-cols-3 gap-2">{Array.from({ length: 9 }).map((_, index) => <div key={index} className={`aspect-square rounded-xl animate-pulse ${isNight ? 'bg-night-surface' : 'bg-[#DBB9B3]/15'}`}/>)}</div>
          : items.length ? <div className="grid grid-cols-3 gap-2">{items.map(photo => <button key={photo.id} onClick={() => { setActive(photo); setCaptionDraft(photo.caption); setEditingCaption(false) }} className={`text-left rounded-xl overflow-hidden ${isNight ? 'bg-night-surface' : 'chat-dialog-card'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}<img src={photo.thumbnail_url || photo.url} alt={photo.caption || '照片'} loading="lazy" decoding="async" className="w-full aspect-square object-cover"/>
            {(photo.caption || photo.comments?.length > 0) && <div className="px-2 py-1.5"><p className="text-[10px] truncate">{photo.caption || '无文字'}</p><div className="flex justify-between text-[9px] opacity-35"><span>{emojiFor(photo.author)}</span>{photo.comments?.length > 0 && <span className="flex items-center gap-0.5"><MessageCircle size={8}/>{photo.comments.length}</span>}</div></div>}
          </button>)}</div>
          : !loading && <div className="py-16 text-center opacity-35"><Images size={28} className="mx-auto mb-2"/><p className="text-xs">这本专辑还是空的</p></div>}
          {nextCursor && <button onClick={() => load(true, nextCursor)} disabled={loading} className="block mx-auto px-4 py-2 text-xs opacity-55 disabled:opacity-20">{loading ? '正在翻页…' : '再看一些'}</button>}
        </>}
        </>}
      </div>

      <AnimatePresence>{active && <>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setActive(null)} className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm"/>
        <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 280 }} className={`fixed bottom-0 left-0 right-0 z-[71] max-h-[88dvh] rounded-t-2xl overflow-y-auto ${isNight ? 'bg-night-card text-night-text' : 'chat-dialog'}`} style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="flex items-center justify-between p-3 sticky top-0 z-10 backdrop-blur-md"><span className="text-xs opacity-50">{emojiFor(active.author)} · {fmt(active.created_at)}</span><div className="flex gap-1"><button onClick={() => sharePhoto(active)} aria-label="分享照片到 Chat" title="分享到 Chat" className="p-2 opacity-60"><Share2 size={15}/></button><button onClick={() => setDeleteConfirm(active.id)} className="p-2 text-red-400"><Trash2 size={15}/></button><button onClick={() => setActive(null)} className="p-2 opacity-60"><X size={16}/></button></div></div>
          {/* eslint-disable-next-line @next/next/no-img-element */}<img src={active.url} alt={active.caption || '照片'} className="w-full max-h-[50dvh] object-contain bg-black/5"/>
          <div className="p-4 space-y-4">
            <select aria-label="移动到专辑" value={active.album_id} onChange={event => movePhoto(event.target.value)} disabled={busy} className={`w-full text-xs p-2 rounded-lg outline-none ${isNight ? 'bg-night-surface' : 'chat-dialog-field'}`}>{ZONES.map(group => <optgroup key={group.id} label={group.label}>{allAlbums.filter(album => album.zone === group.id).map(album => <option key={album.id} value={album.id}>{album.name}</option>)}</optgroup>)}</select>
            {editingCaption ? <div className="flex gap-2"><textarea value={captionDraft} onChange={event => setCaptionDraft(event.target.value)} rows={2} autoFocus className={`flex-1 text-sm p-2 rounded-xl outline-none resize-none ${isNight ? 'bg-night-surface' : 'chat-dialog-field'}`}/><button onClick={saveCaption} disabled={busy} className="p-2"><Check size={16}/></button></div>
            : <div className="flex gap-2"><p className="flex-1 text-sm opacity-80">{active.caption || '还没有写说明'}</p><button onClick={() => setEditingCaption(true)} className="p-1 opacity-45"><Pencil size={14}/></button></div>}
            <div className="space-y-2">{active.comments?.map((comment, index) => <div key={`${comment.time}-${index}`} className={`text-xs p-2 rounded-xl ${isNight ? 'bg-night-surface' : 'bg-[#DBB9B3]/15'}`}><span className="opacity-45 mr-1">{emojiFor(comment.author)}</span>{comment.content}<span className="opacity-25 ml-2 text-[9px]">{fmt(comment.time)}</span></div>)}
              <div className={`flex gap-2 px-3 py-2 rounded-xl ${isNight ? 'bg-night-surface' : 'chat-dialog-field'}`}><input value={commentDraft} onChange={event => setCommentDraft(event.target.value)} onKeyDown={event => event.key === 'Enter' && !(event.nativeEvent as any).isComposing && void addComment()} placeholder="写句评论…" className="flex-1 bg-transparent outline-none text-sm"/><button onClick={addComment} disabled={busy || !commentDraft.trim()} className="opacity-55 disabled:opacity-20"><Send size={14}/></button></div>
            </div>
          </div>
        </motion.div>
      </>}</AnimatePresence>

      <AnimatePresence>{deleteConfirm && <><motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[80] bg-black/40" onClick={() => setDeleteConfirm(null)}/><motion.div initial={{ scale: .94, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: .94, opacity: 0 }} className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[81] w-[280px] p-5 rounded-2xl text-center ${isNight ? 'bg-night-card' : 'chat-dialog'}`}><Trash2 size={22} className="mx-auto mb-3 text-red-400"/><p className="text-sm mb-4">确定删除这张照片？</p><div className="flex gap-2"><button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2 text-xs opacity-55">取消</button><button onClick={() => remove(deleteConfirm)} disabled={busy} className="flex-1 py-2 rounded-xl text-xs bg-red-500 text-white">删除</button></div></motion.div></>}</AnimatePresence>
    </div>
  )
}
