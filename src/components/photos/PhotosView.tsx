'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '@/lib/theme'
import { useApp } from '@/lib/store'
import { photos as photosApi } from '@/lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import { Camera, Plus, MessageCircle, X, Pencil, Trash2, Check, Send, Lock, Unlock, Eye, EyeOff } from 'lucide-react'

interface PhotoComment { author: string; content: string; time: string }
interface PhotoEntry {
  id: string
  author: string
  url: string
  caption: string
  locked?: boolean
  comments: PhotoComment[]
  created_at: string
  updated_at: string | null
  source?: string
}

const emojiFor = (author: string) => (author === 'fire' ? '🦦' : '🐆')

function fmt(ts: string) {
  try {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`
  } catch { return '' }
}

export function PhotosView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const { currentUser } = useApp()

  const [photos, setPhotos] = useState<PhotoEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState<PhotoEntry | null>(null)
  const [editingCaption, setEditingCaption] = useState(false)
  const [captionDraft, setCaptionDraft] = useState('')
  const [commentDraft, setCommentDraft] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  // Zone management
  const [zone, setZone] = useState<'public' | 'locked'>('public')
  const [unlocked, setUnlocked] = useState(false)
  const [passwordInput, setPasswordInput] = useState('')
  const [hasPassword, setHasPassword] = useState(false)
  const [settingPassword, setSettingPassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')

  // Delete confirmation
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const locked = zone === 'locked' ? true : false
      const d = await photosApi.list({ locked })
      setPhotos(d.photos || [])
    } catch {}
    setLoading(false)
  }, [zone])

  useEffect(() => { load() }, [load])

  // Check if password exists
  useEffect(() => {
    photosApi.password('check').then(r => setHasPassword(r.hasPassword)).catch(() => {})
  }, [])

  // keep the open detail view in sync with fresh data
  useEffect(() => {
    if (active) {
      const fresh = photos.find((p) => p.id === active.id)
      if (fresh && fresh !== active) setActive(fresh)
      if (!fresh) setActive(null)
    }
  }, [photos]) // eslint-disable-line react-hooks/exhaustive-deps

  const onPick = () => fileRef.current?.click()

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = async () => {
      const url = reader.result as string
      await photosApi.write(currentUser, url, '', 'upload', zone === 'locked')
      await load()
    }
    reader.readAsDataURL(file)
  }

  const saveCaption = async () => {
    if (!active) return
    await photosApi.edit(active.id, captionDraft)
    setEditingCaption(false)
    await load()
  }

  const toggleLock = async (id: string, currentLocked: boolean) => {
    await photosApi.edit(id, undefined, !currentLocked)
    await load()
  }

  const remove = async (id: string) => {
    await photosApi.delete(id)
    setActive(null)
    setDeleteConfirm(null)
    await load()
  }

  const addComment = async () => {
    if (!active || !commentDraft.trim()) return
    await photosApi.comment(active.id, currentUser, commentDraft.trim())
    setCommentDraft('')
    await load()
  }

  const verifyPassword = async () => {
    const r = await photosApi.password('verify', passwordInput)
    if (r.ok) {
      setUnlocked(true)
      setPasswordInput('')
    } else {
      alert('密码错误')
    }
  }

  const savePassword = async () => {
    if (!newPassword.trim()) return
    await photosApi.password('set', newPassword.trim())
    setHasPassword(true)
    setSettingPassword(false)
    setNewPassword('')
  }

  // Password gate for locked zone
  const showPasswordGate = zone === 'locked' && !unlocked && hasPassword

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium">📷 照片墙</h2>
            <p className={`text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>我们的日常碎片。</p>
          </div>
          <button onClick={onPick}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs ${isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-day-pinkLight text-day-pink'}`}>
            <Plus size={14} /> 发照片
          </button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        </div>

        {/* Zone tabs */}
        <div className="flex items-center gap-2">
          <button onClick={() => setZone('public')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition ${zone === 'public' ? (isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-day-pinkLight text-day-pink') : 'opacity-50'}`}>
            <Eye size={12} /> 公开区
          </button>
          <button onClick={() => setZone('locked')}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs transition ${zone === 'locked' ? (isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-day-pinkLight text-day-pink') : 'opacity-50'}`}>
            <Lock size={12} /> 上锁区
          </button>
          {zone === 'locked' && (
            <button onClick={() => setSettingPassword(true)}
              className="ml-auto text-[10px] opacity-40 hover:opacity-80">
              {hasPassword ? '修改密码' : '设置密码'}
            </button>
          )}
        </div>

        {/* Password setting dialog */}
        <AnimatePresence>
          {settingPassword && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className={`p-3 rounded-xl ${isNight ? 'bg-night-surface' : 'bg-gray-50'}`}>
              <p className="text-xs mb-2 opacity-60">设置上锁区密码</p>
              <div className="flex items-center gap-2">
                <input value={newPassword} onChange={e => setNewPassword(e.target.value)} type="password" placeholder="输入新密码"
                  className={`flex-1 text-sm p-2 rounded-lg outline-none ${isNight ? 'bg-night-card' : 'bg-white border'}`} />
                <button onClick={savePassword} className={`px-3 py-2 rounded-lg text-xs ${isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}>保存</button>
                <button onClick={() => setSettingPassword(false)} className="text-xs opacity-50">取消</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Password gate */}
        {showPasswordGate ? (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            className={`p-6 rounded-2xl text-center ${isNight ? 'bg-night-surface' : 'bg-white shadow-sm'}`}>
            <Lock size={32} className="mx-auto mb-4 opacity-20" />
            <p className="text-sm mb-4">上锁区需要密码查看</p>
            <div className="flex items-center gap-2 max-w-xs mx-auto">
              <input value={passwordInput} onChange={e => setPasswordInput(e.target.value)} type="password" placeholder="输入密码"
                onKeyDown={e => { if (e.key === 'Enter') verifyPassword() }}
                className={`flex-1 text-sm p-2 rounded-lg outline-none ${isNight ? 'bg-night-card' : 'bg-gray-50 border'}`} />
              <button onClick={verifyPassword} className={`px-4 py-2 rounded-lg text-xs ${isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}>解锁</button>
            </div>
          </motion.div>
        ) : (
          <>
            {photos.length === 0 && !loading && (
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                className={`p-6 rounded-2xl text-center ${isNight ? 'bg-night-surface' : 'bg-white shadow-sm'}`}>
                <div className={`inline-flex items-center justify-center w-16 h-16 rounded-full mb-4 ${isNight ? 'bg-night-card' : 'bg-gray-50'}`}>
                  <Camera size={24} className="opacity-20" />
                </div>
                <p className={`text-sm mb-1 ${isNight ? 'text-night-text' : 'text-day-text'}`}>{zone === 'locked' ? '上锁区还没有照片' : '还没有照片'}</p>
                <p className="text-[10px] opacity-30 mb-4">拍一张，或从相册选一张</p>
              </motion.div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {photos.map((p) => (
                <motion.button key={p.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  onClick={() => { setActive(p); setEditingCaption(false); setCaptionDraft(p.caption) }}
                  className={`text-left rounded-2xl overflow-hidden ${isNight ? 'bg-night-surface' : 'bg-white shadow-sm'}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption} className="w-full aspect-square object-cover" loading="lazy" />
                  <div className="p-2 space-y-1">
                    {p.caption && <p className="text-[11px] line-clamp-2">{p.caption}</p>}
                    <div className="flex items-center justify-between text-[10px] opacity-50">
                      <span>{emojiFor(p.author)} {fmt(p.created_at)}</span>
                      <span className="flex items-center gap-1">
                        {p.locked && <Lock size={9} />}
                        {p.comments?.length > 0 && (
                          <span className="flex items-center gap-0.5"><MessageCircle size={10} />{p.comments.length}</span>
                        )}
                      </span>
                    </div>
                  </div>
                </motion.button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* detail modal */}
      <AnimatePresence>
        {active && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setActive(null)} className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm" />
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 280 }}
              className={`fixed bottom-0 left-0 right-0 z-[71] max-h-[88dvh] rounded-t-2xl overflow-y-auto ${isNight ? 'bg-night-card text-night-text' : 'bg-white text-day-text'}`}
              style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
              <div className="flex items-center justify-between p-3 sticky top-0 backdrop-blur-md">
                <span className="text-xs opacity-50">{emojiFor(active.author)} · {fmt(active.created_at)}</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => toggleLock(active.id, !!active.locked)}
                    className="p-2 rounded-xl opacity-60 hover:opacity-100" title={active.locked ? '解锁' : '上锁'}>
                    {active.locked ? <Unlock size={16} /> : <Lock size={16} />}
                  </button>
                  <button onClick={() => setDeleteConfirm(active.id)} className="p-2 rounded-xl opacity-60 hover:opacity-100 text-red-500"><Trash2 size={16} /></button>
                  <button onClick={() => setActive(null)} className={`p-2 rounded-xl opacity-70 hover:opacity-100 ${isNight ? 'bg-night-surface' : 'bg-gray-100'}`}><X size={16} /></button>
                </div>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={active.url} alt={active.caption} className="w-full max-h-[50dvh] object-contain bg-black/5" />

              <div className="p-4 space-y-4">
                {/* caption */}
                <div>
                  {editingCaption ? (
                    <div className="flex items-start gap-2">
                      <textarea value={captionDraft} onChange={(e) => setCaptionDraft(e.target.value)} rows={2} autoFocus
                        className={`flex-1 text-sm p-2 rounded-xl outline-none resize-none ${isNight ? 'bg-night-surface' : 'bg-gray-50'}`} />
                      <button onClick={saveCaption} className={`p-2 rounded-xl ${isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}><Check size={16} /></button>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <p className="flex-1 text-sm opacity-80">{active.caption || <span className="opacity-40">还没有说明…</span>}</p>
                      <button onClick={() => { setEditingCaption(true); setCaptionDraft(active.caption) }} className="p-1 opacity-50 hover:opacity-100"><Pencil size={14} /></button>
                    </div>
                  )}
                </div>

                {/* comments */}
                <div className="space-y-2">
                  {active.comments?.map((c, i) => (
                    <div key={i} className={`text-xs p-2 rounded-xl ${isNight ? 'bg-night-surface' : 'bg-gray-50'}`}>
                      <span className="opacity-50 mr-1">{emojiFor(c.author)}</span>
                      <span>{c.content}</span>
                      <span className="opacity-30 ml-2 text-[10px]">{fmt(c.time)}</span>
                    </div>
                  ))}
                  <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${isNight ? 'bg-night-surface' : 'bg-gray-50'}`}>
                    <input value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) addComment() }}
                      placeholder="写句评论…" className="flex-1 bg-transparent outline-none text-sm" />
                    <button onClick={addComment} disabled={!commentDraft.trim()} className="opacity-60 hover:opacity-100 disabled:opacity-20"><Send size={15} /></button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete confirmation dialog */}
      <AnimatePresence>
        {deleteConfirm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[80] bg-black/40" onClick={() => setDeleteConfirm(null)} />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className={`fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[81] w-[280px] p-6 rounded-2xl text-center ${isNight ? 'bg-night-card' : 'bg-white shadow-xl'}`}>
              <Trash2 size={24} className="mx-auto mb-3 text-red-400" />
              <p className="text-sm font-medium mb-1">确定删除这张照片？</p>
              <p className="text-[11px] opacity-50 mb-4">删除后不可恢复</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setDeleteConfirm(null)}
                  className={`flex-1 py-2 rounded-xl text-xs ${isNight ? 'bg-night-surface' : 'bg-gray-100'}`}>取消</button>
                <button onClick={() => remove(deleteConfirm)}
                  className="flex-1 py-2 rounded-xl text-xs bg-red-500 text-white">删除</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
