'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { wish as wishApi } from '@/lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Heart, MessageCircle, Send, ChevronDown, ChevronUp, X, Check } from 'lucide-react'
import { format } from 'date-fns'

type Priority = 'want' | 'really' | 'dying'
type Status = 'wishing' | 'doing' | 'done'
interface WishComment { id: string; author: string; content: string; time: string }
interface Wish {
  id: string
  author: string
  title: string
  desc?: string
  priority: Priority
  status: Status
  likes: string[]
  comments: WishComment[]
  created_at: string
  updated_at: string
}

const PRIORITY: Record<Priority, { label: string; emoji: string }> = {
  want:   { label: '想要', emoji: '🌱' },
  really: { label: '很想要', emoji: '🔥' },
  dying:  { label: '死了都要', emoji: '💥' },
}
const PRIORITY_ORDER: Priority[] = ['want', 'really', 'dying']
const PRIORITY_RANK: Record<Priority, number> = { want: 1, really: 2, dying: 3 }

const STATUS: Record<Status, { label: string; emoji: string }> = {
  wishing: { label: '许愿中', emoji: '⭐' },
  doing:   { label: '进行中', emoji: '🚧' },
  done:    { label: '已实现', emoji: '✅' },
}
const STATUS_ORDER: Status[] = ['wishing', 'doing', 'done']

const emojiFor = (a: string) => (a === 'fire' ? '🦦' : '🐆')
const nameFor = (a: string) => (a === 'fire' ? '小火' : '星星')

export function WishlistView() {
  const { currentUser } = useApp()
  const { theme } = useTheme()
  const night = theme === 'night'
  const [wishes, setWishes] = useState<Wish[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const d = await wishApi.list()
      setWishes(Array.isArray(d.wishes) ? d.wishes : [])
    } catch {}
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const mutedCls = night ? 'text-night-muted' : 'text-day-muted'

  const starWishes = wishes.filter(w => w.author === 'star')
  const fireWishes = wishes.filter(w => w.author === 'fire')

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="text-center mb-6">
          <h1 className={`text-2xl font-semibold ${night ? 'text-night-text' : 'text-day-text'}`}>
            🌠 2026 愿望清单
          </h1>
          <p className={`text-sm mt-1 ${mutedCls}`}>想要的都写下来，慢慢实现。打勾不删除，留着当成就墙。</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <WishColumn
            owner="star"
            heading="🐆 星星的愿望"
            wishes={starWishes}
            currentUser={currentUser}
            night={night}
            reload={load}
            loading={loading}
          />
          <WishColumn
            owner="fire"
            heading="🦦 小火的愿望"
            wishes={fireWishes}
            currentUser={currentUser}
            night={night}
            reload={load}
            loading={loading}
          />
        </div>
      </div>
    </div>
  )
}

function WishColumn({
  owner, heading, wishes, currentUser, night, reload, loading,
}: {
  owner: string
  heading: string
  wishes: Wish[]
  currentUser: string
  night: boolean
  reload: () => void
  loading: boolean
}) {
  const [showAdd, setShowAdd] = useState(false)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [priority, setPriority] = useState<Priority>('want')

  const accent = night ? 'text-night-amber' : 'text-day-pink'
  const mutedCls = night ? 'text-night-muted' : 'text-day-muted'
  const panelCls = night ? 'bg-night-surface/40 border-night-border' : 'bg-day-pinkLight/40 border-day-border'
  const canAdd = currentUser === owner

  const active = wishes
    .filter(w => w.status !== 'done')
    .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || b.created_at.localeCompare(a.created_at))
  const done = wishes
    .filter(w => w.status === 'done')
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  const submit = async () => {
    if (!title.trim()) return
    await wishApi.add(owner, title.trim(), { desc: desc.trim() || undefined, priority })
    setTitle(''); setDesc(''); setPriority('want'); setShowAdd(false)
    reload()
  }

  return (
    <div className={`rounded-2xl border p-4 ${panelCls}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className={`text-base font-semibold ${night ? 'text-night-text' : 'text-day-text'}`}>{heading}</h2>
        {canAdd && (
          <button
            onClick={() => setShowAdd(v => !v)}
            className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg ${night ? 'bg-night-surface hover:bg-night-amber/15' : 'bg-white hover:bg-day-pink/15'} ${accent}`}
          >
            <Plus size={14} /> 许个愿
          </button>
        )}
      </div>

      <AnimatePresence>
        {showAdd && canAdd && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className={`mb-3 rounded-xl border p-3 overflow-hidden ${night ? 'bg-night-card border-night-border' : 'bg-white border-day-border'}`}
          >
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="想要什么？（短短一句）"
              className={`no-frame w-full text-sm bg-transparent outline-none px-1 py-1 border-b ${night ? 'border-night-border' : 'border-day-border'}`}
              onKeyDown={e => { if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) submit() }}
            />
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="想多说两句？（可选）"
              rows={2}
              className={`no-frame w-full text-sm bg-transparent outline-none px-1 py-1 mt-2 resize-none border-b ${night ? 'border-night-border' : 'border-day-border'}`}
            />
            <div className="flex items-center justify-between mt-3">
              <div className="flex gap-1">
                {PRIORITY_ORDER.map(p => (
                  <button
                    key={p}
                    onClick={() => setPriority(p)}
                    className={`text-xs px-2 py-1 rounded-lg transition ${priority === p
                      ? (night ? 'bg-night-amber/20 text-night-amber' : 'bg-day-pink/15 text-day-pink')
                      : (night ? 'text-night-muted hover:bg-night-surface' : 'text-day-muted hover:bg-day-pinkLight')}`}
                  >
                    {PRIORITY[p].emoji} {PRIORITY[p].label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <button onClick={() => { setShowAdd(false); setTitle(''); setDesc('') }} className={`p-1.5 rounded-lg ${mutedCls}`}>
                  <X size={16} />
                </button>
                <button onClick={submit} className={`p-1.5 rounded-lg ${accent} ${night ? 'hover:bg-night-surface' : 'hover:bg-day-pinkLight'}`}>
                  <Send size={16} />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <p className={`text-sm ${mutedCls} py-4 text-center`}>加载中…</p>
      ) : active.length === 0 && done.length === 0 ? (
        <p className={`text-sm ${mutedCls} py-6 text-center`}>
          {canAdd ? '还没有愿望，点「许个愿」写一个吧。' : '这边还没有愿望。'}
        </p>
      ) : (
        <div className="space-y-2.5">
          {active.map(w => (
            <WishCard key={w.id} w={w} currentUser={currentUser} night={night} reload={reload} />
          ))}

          {done.length > 0 && (
            <div className={`pt-2 mt-1 text-xs ${mutedCls} flex items-center gap-2`}>
              <span>✨ 实现了的愿望</span>
              <span className="opacity-70">({done.length})</span>
              <div className={`flex-1 h-px ${night ? 'bg-night-border' : 'bg-day-border'}`} />
            </div>
          )}
          {done.map(w => (
            <WishCard key={w.id} w={w} currentUser={currentUser} night={night} reload={reload} />
          ))}
        </div>
      )}
    </div>
  )
}

function WishCard({
  w, currentUser, night, reload,
}: {
  w: Wish
  currentUser: string
  night: boolean
  reload: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(w.title)

  const isOwner = currentUser === w.author
  const isDone = w.status === 'done'
  const accent = night ? 'text-night-amber' : 'text-day-pink'
  const mutedCls = night ? 'text-night-muted' : 'text-day-muted'
  const cardCls = night ? 'bg-night-card border-night-border' : 'bg-white border-day-border'

  const likes = Array.isArray(w.likes) ? w.likes : []
  const comments = Array.isArray(w.comments) ? w.comments : []
  const liked = likes.includes(currentUser)

  const cyclePriority = async () => {
    if (!isOwner || isDone) return
    const i = PRIORITY_ORDER.indexOf(w.priority)
    const next = PRIORITY_ORDER[(i + 1) % PRIORITY_ORDER.length]
    await wishApi.edit(w.id, { priority: next })
    reload()
  }
  const cycleStatus = async () => {
    if (!isOwner) return
    const i = STATUS_ORDER.indexOf(w.status)
    const next = STATUS_ORDER[(i + 1) % STATUS_ORDER.length]
    await wishApi.edit(w.id, { status: next })
    reload()
  }
  const toggleDone = async () => {
    if (!isOwner) return
    await wishApi.edit(w.id, { status: isDone ? 'wishing' : 'done' })
    reload()
  }
  const del = async () => {
    if (!isOwner) return
    await wishApi.remove(w.id)
    reload()
  }
  const like = async () => {
    await wishApi.like(w.id, currentUser)
    reload()
  }
  const sendComment = async () => {
    if (!commentDraft.trim()) return
    await wishApi.comment(w.id, currentUser, commentDraft.trim())
    setCommentDraft('')
    setShowComments(true)
    reload()
  }
  const saveTitle = async () => {
    if (titleDraft.trim() && titleDraft.trim() !== w.title) {
      await wishApi.edit(w.id, { title: titleDraft.trim() })
      reload()
    }
    setEditing(false)
  }

  return (
    <div className={`rounded-xl border p-3 ${cardCls} ${isDone ? 'opacity-70' : ''}`}>
      <div className="flex items-start gap-2">
        <button
          onClick={toggleDone}
          disabled={!isOwner}
          title={isOwner ? (isDone ? '取消实现' : '标记为已实现') : ''}
          className={`mt-0.5 shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition ${isDone
            ? (night ? 'bg-night-amber/80 border-night-amber text-night-bg' : 'bg-day-pink border-day-pink text-white')
            : (night ? 'border-night-border' : 'border-day-border')} ${isOwner ? 'cursor-pointer' : 'cursor-default'}`}
        >
          {isDone && <Check size={13} />}
        </button>

        <div className="flex-1 min-w-0">
          {editing && isOwner ? (
            <input
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              autoFocus
              className={`no-frame w-full text-sm bg-transparent outline-none border-b ${night ? 'border-night-border' : 'border-day-border'}`}
            />
          ) : (
            <div
              onClick={() => { if (isOwner && !isDone) { setTitleDraft(w.title); setEditing(true) } }}
              className={`text-sm font-medium break-words ${night ? 'text-night-text' : 'text-day-text'} ${isDone ? 'line-through' : ''} ${isOwner && !isDone ? 'cursor-text' : ''}`}
            >
              {w.title}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <button
              onClick={cyclePriority}
              disabled={!isOwner || isDone}
              className={`text-[11px] px-1.5 py-0.5 rounded-md ${night ? 'bg-night-surface' : 'bg-day-pinkLight'} ${mutedCls} ${isOwner && !isDone ? 'cursor-pointer' : 'cursor-default'}`}
            >
              {PRIORITY[w.priority].emoji} {PRIORITY[w.priority].label}
            </button>
            <button
              onClick={cycleStatus}
              disabled={!isOwner}
              className={`text-[11px] px-1.5 py-0.5 rounded-md ${night ? 'bg-night-surface' : 'bg-day-pinkLight'} ${accent} ${isOwner ? 'cursor-pointer' : 'cursor-default'}`}
            >
              {STATUS[w.status].emoji} {STATUS[w.status].label}
            </button>
            <span className={`text-[11px] ${mutedCls}`}>{format(new Date(w.created_at), 'MM-dd')}</span>
            {w.desc && (
              <button onClick={() => setExpanded(v => !v)} className={`text-[11px] flex items-center gap-0.5 ${mutedCls}`}>
                {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                {expanded ? '收起' : '详情'}
              </button>
            )}
          </div>

          <AnimatePresence>
            {expanded && w.desc && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className={`text-xs mt-2 whitespace-pre-wrap break-words ${mutedCls}`}
              >
                {w.desc}
              </motion.p>
            )}
          </AnimatePresence>

          <div className="flex items-center gap-3 mt-2">
            <button onClick={like} className={`flex items-center gap-1 text-[11px] ${liked ? accent : mutedCls}`}>
              <Heart size={13} className={liked ? 'fill-current' : ''} />
              我也想要{likes.length > 0 ? ` ${likes.length}` : ''}
            </button>
            {likes.length > 0 && (
              <span className="text-[11px]">{likes.map(l => emojiFor(l)).join(' ')}</span>
            )}
            <button onClick={() => setShowComments(v => !v)} className={`flex items-center gap-1 text-[11px] ${mutedCls}`}>
              <MessageCircle size={13} />
              {comments.length > 0 ? comments.length : ''}
            </button>
            {isOwner && (
              <button onClick={del} className={`ml-auto text-[11px] ${mutedCls} hover:text-red-400`}>
                <Trash2 size={13} />
              </button>
            )}
          </div>

          <AnimatePresence>
            {showComments && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-2 overflow-hidden"
              >
                <div className="space-y-1.5">
                  {comments.map(c => (
                    <div key={c.id} className={`text-xs ${mutedCls}`}>
                      <span>{emojiFor(c.author)} {nameFor(c.author)}</span>
                      <span className="opacity-60"> · {format(new Date(c.time), 'MM-dd HH:mm')}</span>
                      <p className={`${night ? 'text-night-text' : 'text-day-text'} break-words`}>{c.content}</p>
                    </div>
                  ))}
                </div>
                <div className={`flex items-center gap-1.5 mt-2 pt-2 border-t ${night ? 'border-night-border' : 'border-day-border'}`}>
                  <span className="text-xs">{emojiFor(currentUser)}</span>
                  <input
                    value={commentDraft}
                    onChange={e => setCommentDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) sendComment() }}
                    placeholder="说点什么…"
                    className="no-frame flex-1 text-xs bg-transparent outline-none"
                  />
                  <button onClick={sendComment} className={`p-1 rounded-md ${accent}`}>
                    <Send size={13} />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
