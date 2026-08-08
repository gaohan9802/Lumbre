'use client'

import { useState, useEffect, useCallback } from 'react'
import { useApp } from '@/lib/store'
import { todo as todoApi } from '@/lib/api'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Check, MessageCircle, Send, History, ChevronLeft, Pencil, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { madridDateKey } from '@/lib/madrid-time'

interface TodoComment { author: string; content: string; time: string }
interface TodoItem {
  id: string
  text: string
  done: boolean
  author: string
  comments: TodoComment[]
  created_at: string
  carried?: boolean
}
interface TodoDay { date: string; items: TodoItem[] }

const emojiFor = (a: string) => (a === 'fire' ? '🦦' : '🐆')

function todayStr() { return madridDateKey() }

export function TodoView() {
  const { currentUser } = useApp()

  const [viewDate, setViewDate] = useState<string>(todayStr())
  const [day, setDay] = useState<TodoDay>({ date: viewDate, items: [] })
  const [receiptDays, setReceiptDays] = useState<string[]>([])
  const [newItem, setNewItem] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [commentFor, setCommentFor] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  const isToday = viewDate === todayStr()

  const load = useCallback(async (date: string) => {
    try {
      const d = await todoApi.list(date === todayStr() ? undefined : date)
      setDay(d.day || { date, items: [] })
      if (d.receiptDays) setReceiptDays(d.receiptDays)
    } catch {}
  }, [])

  useEffect(() => { load(viewDate) }, [viewDate, load])

  const items = day.items
  const doneCount = items.filter((i) => i.done).length
  const progress = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0
  const progressBar = items.length > 0
    ? '█'.repeat(Math.round(progress / 5)) + '░'.repeat(20 - Math.round(progress / 5))
    : '░'.repeat(20)

  const now = new Date()
  const viewDateObj = new Date(viewDate + 'T00:00:00')
  const dateStr = format(viewDateObj, 'yyyy / MM / dd')
  const dayOfWeek = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][viewDateObj.getDay()]
  const timeStr = format(now, 'HH:mm')
  const receiptNo = `#${format(viewDateObj, 'yy')}-${format(viewDateObj, 'MM')}-${format(viewDateObj, 'dd')}-${String(items.length).padStart(3, '0')}`

  const addItem = async () => {
    if (!newItem.trim()) return
    await todoApi.add(newItem.trim(), currentUser, isToday ? undefined : viewDate)
    setNewItem('')
    setShowAdd(false)
    load(viewDate)
  }
  const toggleItem = async (id: string) => {
    await todoApi.toggle(id, isToday ? undefined : viewDate)
    load(viewDate)
  }
  const removeItem = async (id: string) => {
    await todoApi.remove(id, isToday ? undefined : viewDate)
    setDeleteConfirm(null)
    load(viewDate)
  }
  const editItem = async (id: string) => {
    if (!editDraft.trim()) return
    await todoApi.edit(id, editDraft.trim(), isToday ? undefined : viewDate)
    setEditingId(null)
    setEditDraft('')
    load(viewDate)
  }
  const addComment = async (id: string) => {
    if (!commentDraft.trim()) return
    await todoApi.comment(id, currentUser, commentDraft.trim(), isToday ? undefined : viewDate)
    setCommentDraft('')
    setCommentFor(null)
    load(viewDate)
  }

  return (
    <div className="h-full overflow-y-auto flex items-start justify-center p-4 pt-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm receipt-paper rounded-lg p-6 shadow-lg relative"
      >
        <div className="absolute -top-2 left-0 right-0 h-3 receipt-edge-top" />

        {/* Header */}
        <div className="text-center mb-4 relative">
          <button onClick={() => setShowHistory((v) => !v)}
            className="absolute right-0 top-0 text-receipt-ink/40 hover:text-receipt-ink/80" title="小票回顾（近7天）">
            <History size={16} />
          </button>
          {!isToday && (
            <button onClick={() => setViewDate(todayStr())}
              className="absolute left-0 top-0 text-receipt-ink/40 hover:text-receipt-ink/80 flex items-center text-[10px] font-receipt">
              <ChevronLeft size={14} /> 今天
            </button>
          )}
          <p className="text-[10px] tracking-[0.3em] text-receipt-ink/50 mb-1">NEST · GENERAL STORE</p>
          <h2 className="text-xl font-receipt font-bold text-receipt-ink">
            {isToday ? "Today's Receipt" : 'Past Receipt'}
          </h2>
          <p className="text-xs text-receipt-ink/50 mt-1">{dateStr} · {dayOfWeek}</p>
        </div>

        {/* History picker */}
        <AnimatePresence>
          {showHistory && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden mb-3">
              <div className="flex flex-wrap gap-1.5 justify-center py-2 border-y border-dashed border-receipt-line">
                {receiptDays.length === 0 && <span className="text-[10px] text-receipt-ink/40 font-receipt">暂无历史小票</span>}
                {receiptDays.map((d) => (
                  <button key={d} onClick={() => { setViewDate(d); setShowHistory(false) }}
                    className={`text-[10px] font-receipt px-2 py-1 rounded border ${d === viewDate ? 'border-receipt-stamp text-receipt-stamp' : 'border-receipt-ink/20 text-receipt-ink/60'}`}>
                    {format(new Date(d + 'T00:00:00'), 'MM/dd')}{d === todayStr() ? ' 今' : ''}
                  </button>
                ))}
              </div>
              <p className="text-[9px] text-receipt-ink/30 font-receipt text-center mt-1">只保留近 7 天的小票回顾</p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="border-t border-dashed border-receipt-line my-3" />

        {/* Meta */}
        <div className="font-receipt text-xs space-y-1 text-receipt-ink/70">
          <div className="flex justify-between"><span>开店</span><span>00:00</span></div>
          <div className="flex justify-between"><span>柜员</span><span>🐆 · 🦦</span></div>
          <div className="flex justify-between"><span>此刻</span><span>{timeStr}</span></div>
          <div className="flex justify-between"><span>单据号</span><span>{receiptNo}</span></div>
        </div>

        <div className="border-t border-dashed border-receipt-line my-3" />

        <p className="text-center text-[10px] tracking-[0.2em] text-receipt-ink/50 mb-3">
          {isToday ? "TODAY'S ORDER" : 'ORDER'} · {items.length} 项
        </p>

        {/* Items */}
        <div className="space-y-2 min-h-[100px]">
          <AnimatePresence>
            {items.map((item) => (
              <motion.div key={item.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10, height: 0 }}
                className="font-receipt text-sm">
                <div className="flex items-center gap-2 group">
                  <button onClick={() => toggleItem(item.id)}
                    className={`w-5 h-5 flex-shrink-0 flex items-center justify-center rounded border ${item.done ? 'border-receipt-stamp text-receipt-stamp' : 'border-receipt-ink/30'}`}>
                    {item.done && <Check size={12} />}
                  </button>
                  {editingId === item.id ? (
                    <div className="flex-1 flex items-center gap-1">
                      <input value={editDraft} onChange={e => setEditDraft(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) editItem(item.id) }}
                        autoFocus className="flex-1 bg-transparent outline-none font-receipt text-sm text-receipt-ink border-b border-dashed border-receipt-line" />
                      <button onClick={() => editItem(item.id)} className="text-receipt-stamp"><Check size={12} /></button>
                      <button onClick={() => setEditingId(null)} className="opacity-40"><X size={12} /></button>
                    </div>
                  ) : (
                    <span className={`flex-1 ${item.done ? 'line-through text-receipt-ink/40' : 'text-receipt-ink'}`}>
                      {item.carried && <span title="从前一天顺延" className="text-receipt-stamp mr-1">↻</span>}
                      {item.text}
                    </span>
                  )}
                  <span className="text-xs" title={item.author === 'fire' ? '猜猜写的' : '星星写的'}>{emojiFor(item.author)}</span>
                  <button onClick={() => { setEditingId(item.id); setEditDraft(item.text) }}
                    className="opacity-0 group-hover:opacity-40 hover:opacity-100 transition">
                    <Pencil size={11} />
                  </button>
                  <button onClick={() => setCommentFor(commentFor === item.id ? null : item.id)}
                    className={`transition ${item.comments?.length ? 'text-receipt-ink/50' : 'opacity-0 group-hover:opacity-40 hover:opacity-100'}`}>
                    <span className="flex items-center gap-0.5"><MessageCircle size={12} />{item.comments?.length ? item.comments.length : ''}</span>
                  </button>
                  <button onClick={() => setDeleteConfirm(item.id)} className="opacity-0 group-hover:opacity-40 hover:opacity-100 transition">
                    <Trash2 size={11} />
                  </button>
                </div>

                {/* comments */}
                <AnimatePresence>
                  {(commentFor === item.id || item.comments?.length > 0) && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="ml-7 mt-1 space-y-1">
                      {item.comments?.map((c, i) => (
                        <div key={i} className="text-[11px] text-receipt-ink/60">
                          <span className="mr-1">{emojiFor(c.author)}</span>{c.content}
                        </div>
                      ))}
                      {commentFor === item.id && (
                        <div className="flex items-center gap-1">
                          <input value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) addComment(item.id) }}
                            placeholder="写句评语…" autoFocus
                            className="flex-1 bg-transparent outline-none text-[11px] text-receipt-ink placeholder:text-receipt-ink/30 border-b border-dashed border-receipt-line" />
                          <button onClick={() => addComment(item.id)} className="text-receipt-stamp"><Send size={12} /></button>
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Add */}
          {showAdd ? (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center gap-2 font-receipt text-sm">
              <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded border border-receipt-ink/30" />
              <input value={newItem} onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) addItem() }}
                placeholder="新任务..." autoFocus
                className="flex-1 bg-transparent outline-none font-receipt text-sm text-receipt-ink placeholder:text-receipt-ink/30" />
              <button onClick={addItem} className="text-receipt-stamp"><Check size={14} /></button>
            </motion.div>
          ) : (
            <button onClick={() => setShowAdd(true)} className="text-xs text-receipt-ink/30 hover:text-receipt-ink/60 font-receipt">
              + 新增一项
            </button>
          )}
        </div>

        <div className="border-t border-dashed border-receipt-line my-3" />

        {/* Summary */}
        <div className="font-receipt text-xs space-y-1 text-receipt-ink/70">
          <div className="flex justify-between"><span>小计</span><span>{items.length} 项</span></div>
          <div className="flex justify-between"><span>已结清</span><span>{doneCount} 项</span></div>
          <div className="flex justify-between"><span>未结清</span><span>{items.length - doneCount} 项</span></div>
          <div className="flex justify-between items-center"><span>进度</span><span className="text-[10px]">{progressBar} {progress}%</span></div>
        </div>

        <div className="border-t border-dashed border-receipt-line my-3" />

        {/* Footer */}
        <div className="text-center space-y-2">
          {progress === 100 && items.length > 0 ? (
            <motion.div initial={{ scale: 0, rotate: -15 }} animate={{ scale: 1, rotate: -5 }}
              className="inline-block border-2 border-receipt-stamp text-receipt-stamp px-4 py-1 rounded text-sm font-receipt font-bold" style={{ transform: 'rotate(-5deg)' }}>
              PAID · 谢谢
            </motion.div>
          ) : (
            <p className="text-[10px] text-receipt-ink/30 font-receipt">今天也辛苦了 🐆 · 🦦</p>
          )}
          <p className="text-[10px] text-receipt-ink/20 font-receipt">未结清的不会消失，会顺延到第二天。</p>
          <div className="flex justify-center gap-px mt-2">
            {Array.from({ length: 30 }, (_, i) => (
              <div key={i} className="bg-receipt-ink/20" style={{ width: i % 3 === 0 ? '2px' : '1px', height: '20px' }} />
            ))}
          </div>
          <p className="text-[8px] text-receipt-ink/20 font-receipt tracking-widest">
            {format(viewDateObj, 'yy MM dd')} {receiptNo.slice(1)}
          </p>
        </div>
      </motion.div>

      {/* Delete confirmation */}
      <AnimatePresence>
        {deleteConfirm && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[80] bg-black/30" onClick={() => setDeleteConfirm(null)} />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[81] w-[260px] p-5 rounded-2xl text-center bg-white shadow-xl">
              <p className="text-sm font-medium mb-3">确定删除这项待办？</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setDeleteConfirm(null)} className="flex-1 py-2 rounded-xl text-xs bg-gray-100">取消</button>
                <button onClick={() => removeItem(deleteConfirm)} className="flex-1 py-2 rounded-xl text-xs bg-red-500 text-white">删除</button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
