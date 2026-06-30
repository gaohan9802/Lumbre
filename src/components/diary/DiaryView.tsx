'use client'

import { useState, useEffect } from 'react'
import { useTheme } from '@/lib/theme'
import { useApp } from '@/lib/store'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Lock, Clock, ChevronLeft, Send,
  Trash2, MessageCircle, FilePlus2, Key,
} from 'lucide-react'
import { format } from 'date-fns'
import { diary } from '@/lib/api'

interface Comment {
  commenter: 'star' | 'fire'
  content: string
  timestamp: string
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
  locked?: boolean
}

export function DiaryView() {
  const { theme } = useTheme()
  const { currentUser } = useApp()
  const isNight = theme === 'night'

  const [entries, setEntries] = useState<DiaryEntry[]>([])
  const [selected, setSelected] = useState<DiaryEntry | null>(null)
  const [isWriting, setIsWriting] = useState(false)
  const [loading, setLoading] = useState(true)

  // Write form
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private' | 'timed'>('public')
  const [revealAt, setRevealAt] = useState('')

  // Detail extras
  const [commentText, setCommentText] = useState('')
  const [appendText, setAppendText] = useState('')
  const [showAppend, setShowAppend] = useState(false)

  // Unlock modal
  const [unlocking, setUnlocking] = useState<DiaryEntry | null>(null)
  const [unlockPwd, setUnlockPwd] = useState('')
  const [unlockErr, setUnlockErr] = useState('')

  useEffect(() => { loadEntries() }, [currentUser])

  const loadEntries = async () => {
    setLoading(true)
    const data = await diary.read(currentUser)
    if (data.entries) setEntries(data.entries)
    setLoading(false)
  }

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
      setUnlocking(entry)
      setUnlockPwd('')
      setUnlockErr('')
    } else {
      setSelected(entry)
    }
  }

  const handleUnlock = async () => {
    if (!unlocking || !unlockPwd) return
    const data = await diary.unlock(currentUser, unlocking.author, unlockPwd, unlocking.date, unlocking.time_id)
    if (data.entries?.length || data.entry || data.content) {
      // backend may return either {entries:[...]} or the entry directly
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
    // Refresh & re-select
    const data = await diary.read(currentUser)
    if (data.entries) {
      setEntries(data.entries)
      const fresh = data.entries.find((e: DiaryEntry) =>
        e.date === selected.date && e.author === selected.author && e.time_id === selected.time_id
      )
      if (fresh) setSelected(fresh)
    }
  }

  const handleAppend = async () => {
    if (!selected || !appendText.trim()) return
    await diary.update({
      author: selected.author,
      target_date: selected.date,
      new_content: appendText.trim(),
      time_id: selected.time_id,
    })
    setAppendText('')
    setShowAppend(false)
    const data = await diary.read(currentUser)
    if (data.entries) {
      setEntries(data.entries)
      const fresh = data.entries.find((e: DiaryEntry) =>
        e.date === selected.date && e.author === selected.author && e.time_id === selected.time_id
      )
      if (fresh) setSelected(fresh)
    }
  }

  const handleDelete = async () => {
    if (!selected) return
    if (!confirm('删掉这篇？')) return
    await diary.delete(selected.author, selected.date, selected.time_id)
    setSelected(null)
    loadEntries()
  }

  const canEdit = selected && selected.author === currentUser

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between">
        {selected ? (
          <button
            onClick={() => { setSelected(null); setShowAppend(false); setCommentText('') }}
            className="flex items-center gap-1 text-sm opacity-60 hover:opacity-100"
          >
            <ChevronLeft size={16} /> 返回
          </button>
        ) : (
          <h2 className="text-lg font-medium">📔 日记本</h2>
        )}
        {!selected && !isWriting && (
          <button
            onClick={() => setIsWriting(true)}
            className={`p-2 rounded-xl transition ${
              isNight ? 'hover:bg-night-surface text-night-amber' : 'hover:bg-day-lemon text-day-pink'
            }`}
          >
            <Plus size={20} />
          </button>
        )}
        {selected && canEdit && (
          <button
            onClick={handleDelete}
            className="p-2 rounded-xl opacity-40 hover:opacity-100 hover:text-red-500 transition"
            title="删除"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        <AnimatePresence mode="wait">
          {isWriting ? (
            <motion.div
              key="write"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="标题"
                className={`w-full text-lg font-medium bg-transparent outline-none ${
                  isNight ? 'placeholder:text-night-muted' : 'placeholder:text-day-muted'
                }`}
              />

              <div className="flex gap-2 flex-wrap items-center">
                {(['public', 'private', 'timed'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVisibility(v)}
                    className={`px-3 py-1 rounded-lg text-xs transition ${
                      visibility === v
                        ? isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-day-honey/60 text-day-pink'
                        : isNight ? 'bg-night-surface text-night-muted' : 'bg-gray-100 text-day-muted'
                    }`}
                  >
                    {v === 'public' && '👁 公开'}
                    {v === 'private' && '🔒 私密'}
                    {v === 'timed' && '⏰ 定时'}
                  </button>
                ))}

                {visibility === 'timed' && (
                  <input
                    type="datetime-local"
                    value={revealAt}
                    onChange={(e) => setRevealAt(e.target.value)}
                    className={`text-xs px-2 py-1 rounded-lg bg-transparent border ${
                      isNight ? 'border-night-border text-night-text' : 'border-day-muted/30 text-day-text'
                    }`}
                  />
                )}
              </div>

              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="今天想说什么..."
                rows={12}
                className={`w-full bg-transparent outline-none text-sm leading-relaxed resize-none ${
                  isNight ? 'placeholder:text-night-muted' : 'placeholder:text-day-muted'
                }`}
              />

              <div className="flex gap-2">
                <button
                  onClick={() => setIsWriting(false)}
                  className={`px-4 py-2 rounded-xl text-sm ${
                    isNight ? 'bg-night-surface text-night-muted' : 'bg-gray-100 text-day-muted'
                  }`}
                >
                  取消
                </button>
                <button
                  onClick={handleWrite}
                  disabled={!title.trim() || !content.trim() || (visibility === 'timed' && !revealAt)}
                  className={`px-4 py-2 rounded-xl text-sm transition disabled:opacity-30 disabled:cursor-not-allowed ${
                    isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'
                  }`}
                >
                  写好了
                </button>
              </div>
            </motion.div>
          ) : selected ? (
            <motion.div
              key="read"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="space-y-4"
            >
              <div className="flex items-center gap-2 text-xs opacity-50 flex-wrap">
                <span>{selected.author === 'star' ? '⭐' : '🔥'}</span>
                <span>{selected.date}</span>
                {selected.visibility === 'private' && <Lock size={12} />}
                {selected.visibility === 'timed' && (
                  <>
                    <Clock size={12} />
                    {selected.reveal_at && <span>解封 {selected.reveal_at}</span>}
                  </>
                )}
              </div>
              <h3 className="text-xl font-medium">{selected.title}</h3>
              <p className="text-sm leading-relaxed whitespace-pre-wrap opacity-80">
                {selected.content}
              </p>

              {/* Append */}
              {canEdit && (
                <div className="pt-2">
                  {showAppend ? (
                    <div className="space-y-2">
                      <textarea
                        value={appendText}
                        onChange={(e) => setAppendText(e.target.value)}
                        placeholder="追加..."
                        rows={4}
                        className={`w-full text-sm bg-transparent outline-none resize-none border rounded-lg p-2 ${
                          isNight ? 'border-night-border' : 'border-day-muted/20'
                        }`}
                      />
                      <div className="flex gap-2 text-xs">
                        <button onClick={() => { setShowAppend(false); setAppendText('') }} className="opacity-50">取消</button>
                        <button
                          onClick={handleAppend}
                          disabled={!appendText.trim()}
                          className={`px-3 py-1 rounded-lg ${
                            isNight ? 'bg-night-amber/80 text-night-bg' : 'bg-day-pink text-white'
                          } disabled:opacity-30`}
                        >
                          追加
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAppend(true)}
                      className="flex items-center gap-1 text-xs opacity-50 hover:opacity-100"
                    >
                      <FilePlus2 size={12} /> 续一段
                    </button>
                  )}
                </div>
              )}

              {/* Comments */}
              <div className="pt-4 border-t border-current/10 space-y-3">
                <div className="flex items-center gap-2 text-xs opacity-50">
                  <MessageCircle size={12} />
                  <span>评论 {selected.comments?.length || 0}</span>
                </div>
                {selected.comments?.map((c, i) => (
                  <div key={i} className="text-sm opacity-80 flex gap-2">
                    <span>{c.commenter === 'star' ? '⭐' : '🔥'}</span>
                    <span className="flex-1">{c.content}</span>
                    <span className="text-[10px] opacity-40 self-end">{c.timestamp?.slice(11, 16)}</span>
                  </div>
                ))}
                <div className="flex gap-2 items-center">
                  <input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleComment()}
                    placeholder="留个言..."
                    className={`flex-1 text-sm bg-transparent outline-none border-b py-1 ${
                      isNight ? 'border-night-border placeholder:text-night-muted' : 'border-day-muted/20 placeholder:text-day-muted'
                    }`}
                  />
                  <button onClick={handleComment} disabled={!commentText.trim()} className="p-1 disabled:opacity-30">
                    <Send size={14} />
                  </button>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div key="list" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              {loading ? (
                <div className="text-center py-12 opacity-30 text-sm">加载中...</div>
              ) : entries.length === 0 ? (
                <div className="text-center py-12 opacity-30 space-y-2">
                  <span className="text-3xl">📔</span>
                  <p className="text-sm">还没有日记</p>
                  <p className="text-xs">点击右上角 + 写一篇</p>
                </div>
              ) : (
                entries.map((entry, i) => (
                  <motion.button
                    key={`${entry.date}-${entry.time_id || i}`}
                    onClick={() => handleEntryClick(entry)}
                    className={`w-full text-left p-4 rounded-2xl transition ${
                      isNight ? 'bg-night-surface hover:bg-night-surface/80' : 'bg-white shadow-sm hover:shadow-md'
                    }`}
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.99 }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs opacity-50">
                        {entry.author === 'star' ? '⭐' : '🔥'} {entry.date}
                      </span>
                      <div className="flex gap-1">
                        {entry.visibility === 'private' && <Lock size={12} className="opacity-40" />}
                        {entry.visibility === 'timed' && <Clock size={12} className="opacity-40" />}
                        {entry.comments && entry.comments.length > 0 && (
                          <span className="text-[10px] opacity-40">💬{entry.comments.length}</span>
                        )}
                      </div>
                    </div>
                    <h4 className="font-medium text-sm">{entry.title}</h4>
                    {entry.locked ? (
                      <p className="text-xs opacity-30 mt-1 italic">🔒 需要密码</p>
                    ) : (
                      <p className="text-xs opacity-50 mt-1 line-clamp-2">{entry.content}</p>
                    )}
                  </motion.button>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Unlock modal */}
      <AnimatePresence>
        {unlocking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={() => setUnlocking(null)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 10 }}
              onClick={(e) => e.stopPropagation()}
              className={`w-80 p-6 rounded-2xl space-y-4 ${
                isNight ? 'bg-night-card' : 'bg-white'
              }`}
            >
              <div className="flex items-center gap-2">
                <Key size={16} className={isNight ? 'text-night-amber' : 'text-day-heart'} />
                <span className="text-sm font-medium">解锁日记</span>
              </div>
              <p className="text-xs opacity-60">{unlocking.title}</p>
              <input
                type="password"
                value={unlockPwd}
                onChange={(e) => { setUnlockPwd(e.target.value); setUnlockErr('') }}
                onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                autoFocus
                placeholder="密码"
                className={`w-full text-sm bg-transparent outline-none border-b py-2 ${
                  isNight ? 'border-night-border' : 'border-day-muted/20'
                }`}
              />
              {unlockErr && <p className="text-xs text-red-500">{unlockErr}</p>}
              <div className="flex gap-2 justify-end text-sm">
                <button onClick={() => setUnlocking(null)} className="opacity-50 px-3 py-1">取消</button>
                <button
                  onClick={handleUnlock}
                  disabled={!unlockPwd}
                  className={`px-3 py-1 rounded-lg disabled:opacity-30 ${
                    isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'
                  }`}
                >
                  打开
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
