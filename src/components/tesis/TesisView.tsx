'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { tesis as tesisApi } from '@/lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Check, X, MessageCircle, Send, Minus } from 'lucide-react'
import { format } from 'date-fns'

interface Chapter {
  id: string
  title: string
  totalPages: number
  currentPages: number
  created_at: string
  updated_at: string
}
interface Comment { id: string; author: string; content: string; time: string }
interface ProgressPoint { date: string; done: number; total: number; percent: number }
interface Totals { done: number; total: number; percent: number }

const emojiFor = (a: string) => (a === 'fire' ? '🦦' : '🐆')

export function TesisView() {
  const { currentUser } = useApp()
  const { theme } = useTheme()
  const night = theme === 'night'

  const [chapters, setChapters] = useState<Chapter[]>([])
  const [comments, setComments] = useState<Comment[]>([])
  const [progress, setProgress] = useState<ProgressPoint[]>([])
  const [totals, setTotals] = useState<Totals>({ done: 0, total: 0, percent: 0 })
  const [loading, setLoading] = useState(true)

  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newTotal, setNewTotal] = useState('')
  const [commentDraft, setCommentDraft] = useState('')

  const accent = night ? 'text-night-amber' : 'text-day-pink'
  const accentBg = night ? 'bg-night-amber' : 'bg-day-pink'
  const cardCls = night ? 'bg-night-card border-night-border' : 'bg-white border-day-border'
  const mutedCls = night ? 'text-night-muted' : 'text-day-muted'

  const load = useCallback(async () => {
    try {
      const d = await tesisApi.list()
      setChapters(d.chapters || [])
      setComments(d.comments || [])
      setProgress(d.progress || [])
      setTotals(d.totals || { done: 0, total: 0, percent: 0 })
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const addChapter = async () => {
    if (!newTitle.trim()) return
    await tesisApi.add(newTitle.trim(), parseInt(newTotal) || 0)
    setNewTitle(''); setNewTotal(''); setShowAdd(false)
    load()
  }

  const patchChapter = async (id: string, patch: { title?: string; totalPages?: number; currentPages?: number }) => {
    await tesisApi.update(id, patch)
    load()
  }

  const removeChapter = async (id: string) => {
    await tesisApi.remove(id)
    load()
  }

  const sendComment = async () => {
    if (!commentDraft.trim()) return
    await tesisApi.comment(currentUser, commentDraft.trim())
    setCommentDraft('')
    load()
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {/* Header — overall progress */}
        <div className={`rounded-2xl border p-5 ${cardCls}`}>
          <div className="flex items-baseline justify-between">
            <h1 className="text-lg font-semibold flex items-center gap-2">📄 论文进度</h1>
            <span className={`text-3xl font-bold ${accent}`}>{totals.percent}%</span>
          </div>
          <div className={`mt-1 text-sm ${mutedCls}`}>
            共 {totals.total} 页 · 已完成 {totals.done} 页 · 剩余 {Math.max(0, totals.total - totals.done)} 页
          </div>
          <div className={`mt-3 h-2.5 rounded-full overflow-hidden ${night ? 'bg-night-surface' : 'bg-day-pinkLight'}`}>
            <motion.div
              className={`h-full rounded-full ${accentBg}`}
              initial={{ width: 0 }}
              animate={{ width: `${totals.percent}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
        </div>

        {/* Line chart */}
        <ProgressChart progress={progress} night={night} accent={night ? '#f4b860' : '#e8879a'} />

        {/* Chapters */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">章节</h2>
            <button
              onClick={() => setShowAdd(v => !v)}
              className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg ${night ? 'bg-night-surface hover:bg-night-amber/15' : 'bg-day-pinkLight hover:bg-day-pink/15'} ${accent}`}
            >
              <Plus size={14} /> 新建章节
            </button>
          </div>

          <AnimatePresence>
            {showAdd && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className={`rounded-xl border p-3 space-y-2 overflow-hidden ${cardCls}`}
              >
                <input
                  autoFocus
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="章节标题（如：第一章 引言）"
                  className={`no-frame w-full text-sm bg-transparent outline-none px-1 py-1 border-b ${night ? 'border-night-border' : 'border-day-border'}`}
                />
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={0}
                    value={newTotal}
                    onChange={e => setNewTotal(e.target.value)}
                    placeholder="总页数"
                    className={`no-frame w-28 text-sm bg-transparent outline-none px-1 py-1 border-b ${night ? 'border-night-border' : 'border-day-border'}`}
                  />
                  <div className="flex-1" />
                  <button onClick={() => { setShowAdd(false); setNewTitle(''); setNewTotal('') }} className={`p-1.5 rounded-lg ${mutedCls}`}><X size={16} /></button>
                  <button onClick={addChapter} className={`p-1.5 rounded-lg ${accentBg} text-white`}><Check size={16} /></button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {loading ? (
            <p className={`text-sm ${mutedCls}`}>加载中…</p>
          ) : chapters.length === 0 ? (
            <p className={`text-sm ${mutedCls}`}>还没有章节，点「新建章节」开始追踪。</p>
          ) : (
            chapters.map(ch => (
              <ChapterCard
                key={ch.id}
                ch={ch}
                night={night}
                accent={accent}
                accentBg={accentBg}
                cardCls={cardCls}
                mutedCls={mutedCls}
                onPatch={patchChapter}
                onRemove={removeChapter}
              />
            ))
          )}
        </div>

        {/* AI comments */}
        <div className="space-y-3">
          <h2 className="text-sm font-medium flex items-center gap-1.5"><MessageCircle size={15} /> 星星踹你一脚</h2>
          <div className={`rounded-xl border p-3 flex items-center gap-2 ${cardCls}`}>
            <span className="text-base">{emojiFor(currentUser)}</span>
            <input
              value={commentDraft}
              onChange={e => setCommentDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) sendComment() }}
              placeholder="写一条评论…"
              className="no-frame flex-1 text-sm bg-transparent outline-none"
            />
            <button onClick={sendComment} className={`p-1.5 rounded-lg ${accent}`}><Send size={16} /></button>
          </div>

          {comments.length === 0 ? (
            <p className={`text-sm ${mutedCls}`}>还没有评论。星星查看进度后会在这里留言。</p>
          ) : (
            <div className="space-y-2">
              {[...comments].reverse().map(c => (
                <div key={c.id} className={`rounded-xl border p-3 ${cardCls}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm flex items-center gap-1.5">
                      {emojiFor(c.author)} <span className={mutedCls}>{c.author === 'fire' ? '小火' : '星星'}</span>
                    </span>
                    <span className={`text-[11px] ${mutedCls}`}>{format(new Date(c.time), 'yyyy-MM-dd HH:mm')}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{c.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

function ChapterCard({ ch, night, accent, accentBg, cardCls, mutedCls, onPatch, onRemove }: {
  ch: Chapter; night: boolean; accent: string; accentBg: string; cardCls: string; mutedCls: string
  onPatch: (id: string, patch: { title?: string; totalPages?: number; currentPages?: number }) => void
  onRemove: (id: string) => void
}) {
  const [editTotal, setEditTotal] = useState(false)
  const [totalDraft, setTotalDraft] = useState(String(ch.totalPages))
  const [curDraft, setCurDraft] = useState(String(ch.currentPages))

  useEffect(() => { setCurDraft(String(ch.currentPages)); setTotalDraft(String(ch.totalPages)) }, [ch.currentPages, ch.totalPages])

  const pct = ch.totalPages > 0 ? Math.round((ch.currentPages / ch.totalPages) * 100) : 0

  const commitCur = (v: number) => onPatch(ch.id, { currentPages: v })

  return (
    <div className={`rounded-xl border p-3.5 ${cardCls}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium flex-1">{ch.title}</p>
        <span className={`text-sm font-semibold ${accent}`}>{pct}%</span>
      </div>

      <div className={`mt-2 h-1.5 rounded-full overflow-hidden ${night ? 'bg-night-surface' : 'bg-day-pinkLight'}`}>
        <div className={`h-full rounded-full ${accentBg}`} style={{ width: `${pct}%` }} />
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <div className={`flex items-center gap-1.5 text-sm ${mutedCls}`}>
          <button
            onClick={() => commitCur(Math.max(0, ch.currentPages - 1))}
            className={`p-1 rounded-md ${night ? 'hover:bg-night-surface' : 'hover:bg-day-pinkLight'}`}
          ><Minus size={13} /></button>
          <input
            type="number" min={0}
            value={curDraft}
            onChange={e => setCurDraft(e.target.value)}
            onBlur={() => commitCur(parseInt(curDraft) || 0)}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            className={`no-frame w-12 text-center bg-transparent outline-none border-b ${night ? 'border-night-border' : 'border-day-border'}`}
          />
          <button
            onClick={() => commitCur(ch.totalPages > 0 ? Math.min(ch.totalPages, ch.currentPages + 1) : ch.currentPages + 1)}
            className={`p-1 rounded-md ${night ? 'hover:bg-night-surface' : 'hover:bg-day-pinkLight'}`}
          ><Plus size={13} /></button>
          <span>/</span>
          {editTotal ? (
            <input
              type="number" min={0} autoFocus
              value={totalDraft}
              onChange={e => setTotalDraft(e.target.value)}
              onBlur={() => { onPatch(ch.id, { totalPages: parseInt(totalDraft) || 0 }); setEditTotal(false) }}
              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className={`no-frame w-12 text-center bg-transparent outline-none border-b ${night ? 'border-night-border' : 'border-day-border'}`}
            />
          ) : (
            <button onClick={() => setEditTotal(true)} className="underline decoration-dotted underline-offset-2">{ch.totalPages} 页</button>
          )}
        </div>
        <button onClick={() => onRemove(ch.id)} className={`p-1.5 rounded-lg ${mutedCls} ${night ? 'hover:bg-night-surface' : 'hover:bg-day-pinkLight'}`}>
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}

function ProgressChart({ progress, night, accent }: { progress: ProgressPoint[]; night: boolean; accent: string }) {
  const cardCls = night ? 'bg-night-card border-night-border' : 'bg-white border-day-border'
  const mutedCls = night ? 'text-night-muted' : 'text-day-muted'
  const grid = night ? '#3a3a3a' : '#f0dfe4'

  if (progress.length === 0) {
    return (
      <div className={`rounded-2xl border p-5 ${cardCls}`}>
        <h2 className="text-sm font-medium mb-1">每日进度</h2>
        <p className={`text-sm ${mutedCls}`}>还没有数据点。更新章节页数后，这里会画出折线图。</p>
      </div>
    )
  }

  const W = 520, H = 180, pad = 28
  const pts = progress
  const maxDone = Math.max(1, ...pts.map(p => p.done))
  const n = pts.length
  const x = (i: number) => n === 1 ? W / 2 : pad + (i * (W - 2 * pad)) / (n - 1)
  const y = (v: number) => H - pad - (v / maxDone) * (H - 2 * pad)

  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i).toFixed(1)} ${y(p.done).toFixed(1)}`).join(' ')
  const area = `${line} L ${x(n - 1).toFixed(1)} ${(H - pad).toFixed(1)} L ${x(0).toFixed(1)} ${(H - pad).toFixed(1)} Z`

  const showEvery = Math.ceil(n / 6)

  return (
    <div className={`rounded-2xl border p-5 ${cardCls}`}>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-medium">每日进度</h2>
        <span className={`text-[11px] ${mutedCls}`}>累计已完成页数</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="tesisFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* horizontal grid lines */}
        {[0, 0.5, 1].map((f, i) => (
          <line key={i} x1={pad} x2={W - pad} y1={y(maxDone * f)} y2={y(maxDone * f)} stroke={grid} strokeWidth="1" />
        ))}
        <path d={area} fill="url(#tesisFill)" />
        <path d={line} fill="none" stroke={accent} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <g key={p.date}>
            <circle cx={x(i)} cy={y(p.done)} r="3" fill={accent} />
            {(i % showEvery === 0 || i === n - 1) && (
              <text x={x(i)} y={H - pad + 14} textAnchor="middle" fontSize="9" fill={night ? '#8a8a8a' : '#b09199'}>
                {p.date.slice(5)}
              </text>
            )}
          </g>
        ))}
        <text x={pad - 6} y={y(maxDone) + 3} textAnchor="end" fontSize="9" fill={night ? '#8a8a8a' : '#b09199'}>{maxDone}</text>
        <text x={pad - 6} y={y(0) + 3} textAnchor="end" fontSize="9" fill={night ? '#8a8a8a' : '#b09199'}>0</text>
      </svg>
    </div>
  )
}
