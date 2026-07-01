'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '@/lib/theme'
import { useApp } from '@/lib/store'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Lock, Clock, ChevronLeft, Send,
  Trash2, MessageCircle, FilePlus2, Key, Eye, EyeOff, Timer,
} from 'lucide-react'
import { format, parseISO, isToday, isYesterday } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { diary } from '@/lib/api'

interface Comment {
  commenter?: string
  author?: string
  content: string
  timestamp?: string
  time?: string
}

interface DiaryEntry {
  date: string
  author: 'star' | 'fire'
  title: string
  content: string
  visibility: 'public' | 'private' | 'timed'
  reveal_at?: string
  time_id?: string
  comments?: Comment[]
  tags?: string[]
  locked?: boolean
  created_at?: string
}

type AuthorFilter = 'all' | 'star' | 'fire'

function friendlyDate(dateStr: string) {
  try {
    const d = parseISO(dateStr)
    if (isToday(d)) return '今天'
    if (isYesterday(d)) return '昨天'
    return format(d, 'M月d日 EEEE', { locale: zhCN })
  } catch { return dateStr }
}

function friendlyTime(ts?: string) {
  if (!ts) return ''
  try { return ts.slice(11, 16) } catch { return '' }
}

function NotebookBg({ isNight }: { isNight: boolean }) {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
      <svg width="100%" height="100%" className="absolute inset-0">
        <defs>
          <pattern id="ruled" width="100%" height="32" patternUnits="userSpaceOnUse">
            <line
              x1="0" y1="31" x2="100%" y2="31"
              stroke={isNight ? 'rgba(212,165,116,0.06)' : 'rgba(243,164,172,0.15)'}
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#ruled)" />
      </svg>
      <div
        className="absolute top-0 bottom-0 w-px"
        style={{
          left: '2rem',
          background: isNight ? 'rgba(212,165,116,0.08)' : 'rgba(239,64,103,0.08)',
        }}
      />
    </div>
  )
}

export function DiaryView() {
  const { theme } = useTheme()
  const { currentUser } = useApp()
  const isNight = theme === 'night'

  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [selected, setSelected] = useState<DiaryEntry | null>(null)
  const [isWriting, setIsWriting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [authorFilter, setAuthorFilter] = useState<AuthorFilter>('all')

  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private' | 'timed'>('public')
  const [revealAt, setRevealAt] = useState('')

  const [commentText, setCommentText] = useState('')
  const [appendText, setAppendText] = useState('')
  const [showAppend, setShowAppend] = useState(false)

  const [unlocking, setUnlocking] = useState<DiaryEntry | null>(null)
  const [unlockPwd, setUnlockPwd] = useState('')
  const [unlockErr, setUnlockErr] = useState('')

  const scrollRef = useRef<HTMLDivElement>(null)

  const loadEntries = useCallback(async () => {
    setLoading(true)
    const params: any = {}
    if (authorFilter !== 'all') params.author_filter = authorFilter
    const data = await diary.read(currentUser, params)
    const list = Array.isArray(data) ? data : data.entries || []
    setEntries(list)
    setLoading(false)
  }, [currentUser, authorFilter])

  useEffect(() => { loadEntries() }, [loadEntries])

  const grouped = entries.reduce<Record<string, DiaryEntry[]>>((acc, e) => {
    const d = e.date || 'unknown'
    if (!acc[d]) acc[d] = []
    acc[d].push(e)
    return acc
  }, {})
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  const handleWrite = async () => {
    if (!title.trim() || !content.trim()) return
    await diary.write({
      date: format(new Date(), 'yyyy-MM-dd'),
      author: currentUser,
      title,
      content,
      visibility,
      reveal_at: visibility === 'timed' ? revealAt : undefined,
    })
    setTitle(''); setContent(''); setRevealAt(''); setVisibility('public')
    setIsWriting(false)
    loadEntries()
  }

  const handleEntryClick = (entry: DiaryEntry) => {
    if (entry.locked) {
      setUnlocking(entry); setUnlockPwd(''); setUnlockErr('')
    } else {
      setSelected(entry); setShowAppend(false); setCommentText('')
    }
  }

  const handleUnlock = async () => {
    if (!unlocking || !unlockPwd) return
    const data = await diary.unlock(currentUser, unlocking.author, unlockPwd, unlocking.date, unlocking.time_id)
    if (data.entries?.length || data.entry || data.content) {
      const unlocked = data.entries?.[0] || data.entry || { ...unlocking, content: data.content, locked: false }
      setSelected({ ...unlocking, ...unlocked, locked: false })
      setUnlocking(null)
    } else {
      setUnlockErr(data.error || '密码不对')
    }
  }

  const handleComment = async () => {
    if (!selected || !commentText.trim()) return
    await diary.comment({
      target_date: selected.date,
      target_author: selected.author,
      commenter: currentUser,
      content: commentText.trim(),
      time_id: selected.time_id,
    })
    setCommentText('')
    await refreshSelected()
  }

  const handleAppend = async () => {
    if (!selected || !appendText.trim()) return
    await diary.update({
      author: selected.author,
      target_date: selected.date,
      new_content: appendText.trim(),
      time_id: selected.time_id,
    })
    setAppendText(''); setShowAppend(false)
    await refreshSelected()
  }

  const handleDelete = async () => {
    if (!selected || !confirm('删掉这篇？')) return
    await diary.delete(selected.author, selected.date, selected.time_id)
    setSelected(null)
    loadEntries()
  }

  const refreshSelected = async () => {
    const data = await diary.read(currentUser)
    const list = Array.isArray(data) ? data : data.entries || []
    setEntries(list)
    if (selected) {
      const fresh = list.find((e: DiaryEntry) =>
        e.date === selected.date && e.author === selected.author && e.time_id === selected.time_id
      )
      if (fresh) setSelected(fresh)
    }
  }

  const canEdit = selected && selected.author === currentUser

  return (
    <div className={`h-full flex flex-col relative ${isNight ? 'bg-night-bg' : 'bg-[#FBF6F0]'}`}>
      {/* Header */}
      <div className={`relative z-10 px-5 pt-4 pb-3 flex items-center justify-between ${
        isNight ? 'border-b border-night-border/50' : 'border-b border-day-honey/20'
      }`}>
        {selected ? (
          <button
            onClick={() => { setSelected(null); setShowAppend(false); setCommentText('') }}
            className={`flex items-center gap-1.5 text-sm transition ${
              isNight ? 'text-night-muted hover:text-night-text' : 'text-day-muted hover:text-day-text'
            }`}
          >
            <ChevronLeft size={16} /> 返回
          </button>
        ) : (
          <h2 className="text-base font-medium tracking-wide">📔 日记本</h2>
        )}

        <div className="flex items-center gap-2">
          {!selected && !isWriting && (
            <>
              <div className={`flex rounded-lg overflow-hidden text-[11px] ${
                isNight ? 'bg-night-surface' : 'bg-day-honey/20'
              }`}>
                {([['all', '全部'], ['star', '🐆'], ['fire', '🦦']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setAuthorFilter(key as AuthorFilter)}
                    className={`px-2.5 py-1 transition-all ${
                      authorFilter === key
                        ? isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'
                        : isNight ? 'text-night-muted hover:text-night-text' : 'text-day-muted hover:text-day-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setIsWriting(true)}
                className={`p-2 rounded-xl transition ${
                  isNight ? 'hover:bg-night-surface text-night-amber' : 'hover:bg-day-lemon text-day-pink'
                }`}
              >
                <Plus size={18} />
              </button>
            </>
          )}
          {selected && canEdit && (
            <button onClick={handleDelete} className="p-2 rounded-xl opacity-30 hover:opacity-100 hover:text-red-500 transition">
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative">
        <NotebookBg isNight={isNight} />
        <div className="relative z-10 px-5 py-4 pl-12">
          <AnimatePresence mode="wait">
            {isWriting ? (
              /* ── Write Mode ── */
              <motion.div key="write" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -12 }} className="max-w-lg mx-auto space-y-5">
                <p className={`text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
                  {format(new Date(), 'yyyy年M月d日 EEEE', { locale: zhCN })} · 🦦
                </p>
                <input
                  value={title} onChange={(e) => setTitle(e.target.value)}
                  placeholder="标题" autoFocus
                  className={`w-full text-xl font-medium bg-transparent outline-none leading-relaxed ${
                    isNight ? 'placeholder:text-night-muted/50' : 'placeholder:text-day-honey'
                  }`}
                />
                <div className="flex gap-2 flex-wrap items-center">
                  {([['public', '公开', Eye], ['private', '私密', EyeOff], ['timed', '定时', Timer]] as [string, string, any][]).map(([v, label, Icon]) => (
                    <button key={v} onClick={() => setVisibility(v as any)}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs transition-all ${
                        visibility === v
                          ? isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-day-pink text-white'
                          : isNight ? 'bg-night-surface text-night-muted' : 'bg-day-honey/20 text-day-muted'
                      }`}
                    >
                      <Icon size={12} /> {label}
                    </button>
                  ))}
                  {visibility === 'timed' && (
                    <input type="datetime-local" value={revealAt} onChange={(e) => setRevealAt(e.target.value)}
                      className={`text-xs px-3 py-1.5 rounded-full bg-transparent border ${
                        isNight ? 'border-night-border text-night-text' : 'border-day-honey/30 text-day-text'
                      }`}
                    />
                  )}
                </div>
                <textarea
                  value={content} onChange={(e) => setContent(e.target.value)}
                  placeholder="今天想说什么..." rows={14}
                  className={`w-full bg-transparent outline-none text-sm resize-none ${
                    isNight ? 'placeholder:text-night-muted/50' : 'placeholder:text-day-honey'
                  }`}
                  style={{ lineHeight: '2rem' }}
                />
                <div className="flex gap-3 pt-2">
                  <button onClick={() => { setIsWriting(false); setTitle(''); setContent('') }}
                    className={`px-5 py-2.5 rounded-xl text-sm transition ${
                      isNight ? 'bg-night-surface text-night-muted' : 'bg-day-honey/15 text-day-muted'
                    }`}>算了</button>
                  <button onClick={handleWrite}
                    disabled={!title.trim() || !content.trim() || (visibility === 'timed' && !revealAt)}
                    className={`px-5 py-2.5 rounded-xl text-sm transition disabled:opacity-30 disabled:cursor-not-allowed ${
                      isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'
                    }`}>写好了 ✍️</button>
                </div>
              </motion.div>

            ) : selected ? (
              /* ── Read Mode ── */
              <motion.div key="read" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="max-w-lg mx-auto">
                <div className={`flex items-center gap-2 text-xs flex-wrap mb-4 ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
                  <span className="text-sm">{selected.author === 'star' ? '🐆' : '🦦'}</span>
                  <span>{friendlyDate(selected.date)}</span>
                  <span>{friendlyTime(selected.created_at)}</span>
                  {selected.visibility === 'private' && <Lock size={11} className="opacity-60" />}
                  {selected.visibility === 'timed' && <><Clock size={11} className="opacity-60" />{selected.reveal_at && <span className="opacity-50">{selected.reveal_at}</span>}</>}
                </div>
                <h3 className={`text-xl font-medium mb-1 ${isNight ? 'text-night-text' : 'text-day-text'}`}>{selected.title}</h3>
                {selected.tags && selected.tags.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mb-5">
                    {selected.tags.map((tag: string) => (
                      <span key={tag} className={`text-[10px] px-2 py-0.5 rounded-full ${
                        isNight ? 'bg-night-amber/10 text-night-amber/70' : 'bg-day-honey/30 text-day-pink'
                      }`}>{tag}</span>
                    ))}
                  </div>
                )}
                <div className={`text-sm whitespace-pre-wrap ${isNight ? 'text-night-text/85' : 'text-day-text/90'}`} style={{ lineHeight: '2rem' }}>
                  {selected.content}
                </div>

                {canEdit && (
                  <div className="mt-6">
                    {showAppend ? (
                      <div className={`p-3 rounded-xl space-y-2 ${isNight ? 'bg-night-surface/50' : 'bg-day-lemon/30'}`}>
                        <textarea value={appendText} onChange={(e) => setAppendText(e.target.value)}
                          placeholder="续一段..." rows={4} autoFocus
                          className={`w-full text-sm bg-transparent outline-none resize-none ${isNight ? 'placeholder:text-night-muted' : 'placeholder:text-day-muted'}`}
                          style={{ lineHeight: '1.8rem' }}
                        />
                        <div className="flex gap-2 text-xs justify-end">
                          <button onClick={() => { setShowAppend(false); setAppendText('') }} className="opacity-50 hover:opacity-100 px-3 py-1">取消</button>
                          <button onClick={handleAppend} disabled={!appendText.trim()}
                            className={`px-3 py-1 rounded-lg disabled:opacity-30 ${isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}>追加</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setShowAppend(true)}
                        className={`flex items-center gap-1.5 text-xs transition ${isNight ? 'text-night-muted hover:text-night-amber' : 'text-day-muted hover:text-day-pink'}`}>
                        <FilePlus2 size={12} /> 续一段
                      </button>
                    )}
                  </div>
                )}

                {/* Comments */}
                <div className={`mt-8 pt-5 space-y-4 border-t ${isNight ? 'border-night-border/30' : 'border-day-honey/15'}`}>
                  <div className={`flex items-center gap-2 text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
                    <MessageCircle size={13} />
                    <span>{selected.comments?.length || 0} 条留言</span>
                  </div>
                  {selected.comments?.map((c: Comment, i: number) => {
                    const who = c.commenter || c.author || 'unknown'
                    return (
                      <div key={i} className="flex gap-2.5 text-sm">
                        <span className="mt-0.5 text-xs flex-shrink-0">{who === 'star' ? '🐆' : '🦦'}</span>
                        <div className="flex-1 min-w-0">
                          <p className={`leading-relaxed ${isNight ? 'text-night-text/80' : 'text-day-text/85'}`}>{c.content}</p>
                          <span className={`text-[10px] mt-0.5 block ${isNight ? 'text-night-muted/50' : 'text-day-muted/60'}`}>
                            {friendlyTime(c.timestamp || c.time)}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                  <div className={`flex gap-2 items-end rounded-xl p-2 ${isNight ? 'bg-night-surface/50' : 'bg-day-honey/10'}`}>
                    <span className="text-xs pb-1">🦦</span>
                    <input value={commentText} onChange={(e) => setCommentText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleComment()}
                      placeholder="留个言..."
                      className={`flex-1 text-sm bg-transparent outline-none py-1 ${isNight ? 'placeholder:text-night-muted/50' : 'placeholder:text-day-muted'}`}
                    />
                    <button onClick={handleComment} disabled={!commentText.trim()}
                      className={`p-1.5 rounded-lg transition disabled:opacity-20 ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>
                      <Send size={14} />
                    </button>
                  </div>
                </div>
              </motion.div>

            ) : (
              /* ── List Mode ── */
              <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {loading ? (
                  <div className={`text-center py-16 text-sm ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>翻开日记本...</div>
                ) : sortedDates.length === 0 ? (
                  <div className="text-center py-16 space-y-3">
                    <span className="text-4xl">📔</span>
                    <p className={`text-sm ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>还没有日记</p>
                    <p className={`text-xs ${isNight ? 'text-night-muted/50' : 'text-day-muted/60'}`}>点右上角 + 写第一篇</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {sortedDates.map((date: string) => (
                      <div key={date}>
                        <div className={`flex items-center gap-3 mb-3 ${isNight ? 'text-night-amber/60' : 'text-day-pink/70'}`}>
                          <span className="text-xs font-medium tracking-wider">{friendlyDate(date)}</span>
                          <div className={`flex-1 h-px ${isNight ? 'bg-night-amber/10' : 'bg-day-pink/10'}`} />
                        </div>
                        <div className="space-y-3">
                          {grouped[date].map((entry: DiaryEntry, i: number) => (
                            <motion.button
                              key={`${entry.date}-${entry.time_id || i}`}
                              onClick={() => handleEntryClick(entry)}
                              className={`w-full text-left group transition-all duration-200 rounded-2xl p-4 ${
                                isNight
                                  ? 'bg-night-card/60 hover:bg-night-card border border-night-border/30 hover:border-night-amber/20'
                                  : 'bg-white/70 hover:bg-white border border-day-honey/10 hover:border-day-honey/40 hover:shadow-sm'
                              }`}
                              whileTap={{ scale: 0.99 }}
                            >
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs">{entry.author === 'star' ? '🐆' : '🦦'}</span>
                                  <span className={`text-[11px] ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>{friendlyTime(entry.created_at)}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  {entry.visibility === 'private' && <Lock size={11} className="opacity-30" />}
                                  {entry.visibility === 'timed' && <Clock size={11} className="opacity-30" />}
                                  {entry.tags && entry.tags.length > 0 && (
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                                      isNight ? 'bg-night-amber/10 text-night-amber/50' : 'bg-day-honey/25 text-day-pink/70'
                                    }`}>{entry.tags[0]}</span>
                                  )}
                                  {(entry.comments?.length || 0) > 0 && (
                                    <span className={`text-[10px] ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>💬{entry.comments!.length}</span>
                                  )}
                                </div>
                              </div>
                              <h4 className={`text-sm font-medium mb-1 ${isNight ? 'text-night-text' : 'text-day-text'}`}>{entry.title}</h4>
                              {entry.locked ? (
                                <p className={`text-xs italic flex items-center gap-1 ${isNight ? 'text-night-muted/40' : 'text-day-muted/50'}`}>
                                  <Lock size={10} /> 需要密码解锁
                                </p>
                              ) : (
                                <p className={`text-xs line-clamp-2 leading-relaxed ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>{entry.content}</p>
                              )}
                            </motion.button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Unlock modal */}
      <AnimatePresence>
        {unlocking && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setUnlocking(null)}>
            <motion.div initial={{ scale: 0.92, y: 10 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.92, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className={`w-80 p-6 rounded-2xl space-y-4 ${isNight ? 'bg-night-card border border-night-border' : 'bg-white shadow-xl'}`}>
              <div className="flex items-center gap-2">
                <Key size={15} className={isNight ? 'text-night-amber' : 'text-day-pink'} />
                <span className="text-sm font-medium">解锁日记</span>
              </div>
              <p className={`text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
                {unlocking.author === 'star' ? '🐆' : '🦦'} {unlocking.title}
              </p>
              <input type="password" value={unlockPwd}
                onChange={(e) => { setUnlockPwd(e.target.value); setUnlockErr('') }}
                onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                autoFocus placeholder="密码"
                className={`w-full text-sm bg-transparent outline-none border-b py-2 ${isNight ? 'border-night-border' : 'border-day-honey/30'}`}
              />
              {unlockErr && <p className="text-xs text-red-500">{unlockErr}</p>}
              <div className="flex gap-2 justify-end text-sm">
                <button onClick={() => setUnlocking(null)} className="opacity-50 px-3 py-1">取消</button>
                <button onClick={handleUnlock} disabled={!unlockPwd}
                  className={`px-4 py-1.5 rounded-xl disabled:opacity-30 transition ${isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}>打开</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
