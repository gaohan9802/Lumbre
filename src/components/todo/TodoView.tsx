'use client'

import { useState, useEffect } from 'react'
import { useTheme } from '@/lib/theme'
import { useApp } from '@/lib/store'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, X, Check } from 'lucide-react'
import { format } from 'date-fns'

interface TodoItem {
  id: string
  text: string
  done: boolean
  assignee?: string
}

export function TodoView() {
  const { theme } = useTheme()
  const { currentUser } = useApp()

  const now = new Date()
  const dateStr = format(now, 'yyyy / MM / dd')
  const dayOfWeek = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
  const timeStr = format(now, 'HH:mm')
  
  // Local state for now - will connect to API later
  const [items, setItems] = useState<TodoItem[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('starfire-todo-' + format(now, 'yyyy-MM-dd'))
      if (saved) return JSON.parse(saved)
    }
    return []
  })
  const [newItem, setNewItem] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    localStorage.setItem('starfire-todo-' + format(now, 'yyyy-MM-dd'), JSON.stringify(items))
  }, [items])

  const receiptNo = `#${format(now, 'yy')}-${format(now, 'MM')}-${format(now, 'dd')}-${String(items.length).padStart(3, '0')}`
  const doneCount = items.filter(i => i.done).length
  const progress = items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0
  const progressBar = items.length > 0
    ? '█'.repeat(Math.round(progress / 5)) + '░'.repeat(20 - Math.round(progress / 5))
    : '░'.repeat(20)

  const addItem = () => {
    if (!newItem.trim()) return
    setItems(prev => [...prev, {
      id: Date.now().toString(),
      text: newItem.trim(),
      done: false,
      assignee: currentUser,
    }])
    setNewItem('')
    setShowAdd(false)
  }

  const toggleItem = (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, done: !i.done } : i))
  }

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const isNight = theme === 'night'

  // Calculate time until midnight
  const midnight = new Date(now)
  midnight.setHours(23, 52, 0, 0) // 23:52 like in the screenshot
  const minutesLeft = Math.max(0, Math.round((midnight.getTime() - now.getTime()) / 60000))
  const hoursLeft = Math.floor(minutesLeft / 60)
  const minsLeft = minutesLeft % 60
  const closingTime = `${String(hoursLeft).padStart(2, '0')}:${String(minsLeft).padStart(2, '0')}`

  return (
    <div className="h-full overflow-y-auto flex items-start justify-center p-4 pt-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm receipt-paper rounded-lg p-6 shadow-lg relative"
      >
        {/* Zigzag top edge */}
        <div className="absolute -top-2 left-0 right-0 h-3 receipt-edge-top" />
        
        {/* Header */}
        <div className="text-center mb-4">
          <p className="text-[10px] tracking-[0.3em] text-receipt-ink/50 mb-1">
            NEST · GENERAL STORE
          </p>
          <h2 className="text-xl font-receipt font-bold text-receipt-ink">
            Today&apos;s Receipt
          </h2>
          <p className="text-xs text-receipt-ink/50 mt-1">
            {dateStr} · {dayOfWeek}
          </p>
        </div>

        {/* Dashed line */}
        <div className="border-t border-dashed border-receipt-line my-3" />

        {/* Meta info */}
        <div className="font-receipt text-xs space-y-1 text-receipt-ink/70">
          <div className="flex justify-between">
            <span>开店</span>
            <span>00:00</span>
          </div>
          <div className="flex justify-between">
            <span>柜员</span>
            <span>{currentUser === 'fire' ? 'Non' : 'Star'} · {currentUser === 'fire' ? '🔥' : '⭐'}</span>
          </div>
          <div className="flex justify-between">
            <span>此刻</span>
            <span>{timeStr}</span>
          </div>
          <div className="flex justify-between">
            <span>单据号</span>
            <span>{receiptNo}</span>
          </div>
        </div>

        <div className="border-t border-dashed border-receipt-line my-3" />

        {/* Items header */}
        <p className="text-center text-[10px] tracking-[0.2em] text-receipt-ink/50 mb-3">
          TODAY&apos;S ORDER · {items.length} 项
        </p>

        {/* Todo items */}
        <div className="space-y-2 min-h-[100px]">
          <AnimatePresence>
            {items.map((item) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10, height: 0 }}
                className="flex items-center gap-2 group font-receipt text-sm"
              >
                <button
                  onClick={() => toggleItem(item.id)}
                  className={`w-5 h-5 flex-shrink-0 flex items-center justify-center rounded border ${
                    item.done
                      ? 'border-receipt-stamp text-receipt-stamp'
                      : 'border-receipt-ink/30'
                  }`}
                >
                  {item.done && <Check size={12} />}
                </button>
                <span className={`flex-1 ${item.done ? 'line-through text-receipt-ink/40' : 'text-receipt-ink'}`}>
                  {item.text}
                </span>
                <span className="text-[10px] text-receipt-ink/30">
                  {item.assignee === 'fire' ? 'Non' : 'Star'}
                </span>
                <button
                  onClick={() => removeItem(item.id)}
                  className="opacity-0 group-hover:opacity-40 hover:opacity-100 transition"
                >
                  <X size={12} />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>

          {/* Add new item */}
          {showAdd ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-2 font-receipt text-sm"
            >
              <span className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded border border-receipt-ink/30">
              </span>
              <input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addItem()}
                placeholder="新任务..."
                autoFocus
                className="flex-1 bg-transparent outline-none font-receipt text-sm text-receipt-ink placeholder:text-receipt-ink/30"
              />
              <button onClick={addItem} className="text-receipt-stamp">
                <Check size={14} />
              </button>
            </motion.div>
          ) : (
            <button
              onClick={() => setShowAdd(true)}
              className="text-xs text-receipt-ink/30 hover:text-receipt-ink/60 font-receipt"
            >
              + 新增一项
            </button>
          )}
        </div>

        <div className="border-t border-dashed border-receipt-line my-3" />

        {/* Summary */}
        <div className="font-receipt text-xs space-y-1 text-receipt-ink/70">
          <div className="flex justify-between">
            <span>小计</span>
            <span>{items.length} 项</span>
          </div>
          <div className="flex justify-between">
            <span>已结清</span>
            <span>{doneCount} 项</span>
          </div>
          <div className="flex justify-between">
            <span>未结清</span>
            <span>{items.length - doneCount} 项</span>
          </div>
          <div className="flex justify-between items-center">
            <span>进度</span>
            <span className="text-[10px]">{progressBar} {progress}%</span>
          </div>
          <div className="flex justify-between">
            <span>零点结账</span>
            <span>{closingTime} 后</span>
          </div>
        </div>

        <div className="border-t border-dashed border-receipt-line my-3" />

        {/* Footer stamp */}
        <div className="text-center space-y-2">
          {progress === 100 && items.length > 0 ? (
            <motion.div
              initial={{ scale: 0, rotate: -15 }}
              animate={{ scale: 1, rotate: -5 }}
              className="inline-block border-2 border-receipt-stamp text-receipt-stamp px-4 py-1 rounded text-sm font-receipt font-bold"
              style={{ transform: 'rotate(-5deg)' }}
            >
              PAID · 谢谢
            </motion.div>
          ) : (
            <p className="text-[10px] text-receipt-ink/30 font-receipt">
              今天也辛苦了 {currentUser === 'fire' ? '🔥' : '⭐'}
            </p>
          )}
          <p className="text-[10px] text-receipt-ink/20 font-receipt">
            零点之后，未结清的会自动清零。
          </p>
          {/* Barcode-like decoration */}
          <div className="flex justify-center gap-px mt-2">
            {Array.from({ length: 30 }, (_, i) => (
              <div
                key={i}
                className="bg-receipt-ink/20"
                style={{
                  width: Math.random() > 0.5 ? '2px' : '1px',
                  height: '20px',
                }}
              />
            ))}
          </div>
          <p className="text-[8px] text-receipt-ink/20 font-receipt tracking-widest">
            {format(now, 'yy MM dd')} {receiptNo.slice(1)}
          </p>
        </div>
      </motion.div>
    </div>
  )
}
