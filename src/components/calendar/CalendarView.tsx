'use client'

import { useState } from 'react'
import { useTheme } from '@/lib/theme'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight, Heart } from 'lucide-react'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
} from 'date-fns'
import { zhCN } from 'date-fns/locale'

interface Anniversary {
  id: string
  title: string
  date: string
  emoji: string
  recurring: boolean
}

const DEFAULT_ANNIVERSARIES: Anniversary[] = [
  // Placeholder - will load from API
]

export function CalendarView() {
  const { theme } = useTheme()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date())
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>(DEFAULT_ANNIVERSARIES)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newEmoji, setNewEmoji] = useState('❤️')
  const [newDate, setNewDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [newRecurring, setNewRecurring] = useState(true)

  const isNight = theme === 'night'

  // Generate calendar days
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: calStart, end: calEnd })

  const getAnniversaryForDate = (date: Date) => {
    return anniversaries.filter(a => {
      const aDate = new Date(a.date)
      if (a.recurring) {
        return aDate.getMonth() === date.getMonth() && aDate.getDate() === date.getDate()
      }
      return isSameDay(aDate, date)
    })
  }

  const handleAddAnniversary = () => {
    if (!newTitle.trim()) return
    const newAnniv: Anniversary = {
      id: Date.now().toString(),
      title: newTitle,
      date: newDate,
      emoji: newEmoji,
      recurring: newRecurring,
    }
    setAnniversaries(prev => [...prev, newAnniv])
    setNewTitle('')
    setShowAddForm(false)
    // TODO: persist to API
  }

  const weekDays = ['一', '二', '三', '四', '五', '六', '日']

  return (
    <div className="h-full overflow-y-auto px-4 py-6">
      <div className="max-w-md mx-auto space-y-6">
        {/* Month navigation */}
        <div className="flex items-center justify-between">
          <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5">
            <ChevronLeft size={18} />
          </button>
          <h2 className="text-lg font-medium">
            {format(currentMonth, 'yyyy年 M月', { locale: zhCN })}
          </h2>
          <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/5">
            <ChevronRight size={18} />
          </button>
        </div>

        {/* Calendar grid */}
        <div className={`rounded-2xl p-4 ${isNight ? 'bg-night-card' : 'bg-white shadow-sm'}`}>
          {/* Weekday header */}
          <div className="grid grid-cols-7 mb-2">
            {weekDays.map(d => (
              <div key={d} className="text-center text-xs opacity-40 py-1">{d}</div>
            ))}
          </div>

          {/* Days */}
          <div className="grid grid-cols-7 gap-1">
            {days.map((day) => {
              const inMonth = isSameMonth(day, currentMonth)
              const today = isToday(day)
              const selected = selectedDate && isSameDay(day, selectedDate)
              const annivs = getAnniversaryForDate(day)
              const hasAnniv = annivs.length > 0

              return (
                <button
                  key={day.toISOString()}
                  onClick={() => setSelectedDate(day)}
                  className={`
                    relative aspect-square flex flex-col items-center justify-center
                    rounded-xl text-sm transition-all
                    ${!inMonth ? 'opacity-20' : ''}
                    ${selected
                      ? isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-day-pink text-white'
                      : today
                        ? isNight ? 'bg-night-surface' : 'bg-day-lemon'
                        : 'hover:bg-black/5 dark:hover:bg-white/5'
                    }
                  `}
                >
                  <span className={`text-xs ${today ? 'font-bold' : ''}`}>
                    {format(day, 'd')}
                  </span>
                  {hasAnniv && (
                    <span className="text-[8px] mt-0.5">{annivs[0].emoji}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Selected date info */}
        {selectedDate && (
          <motion.div
            key={selectedDate.toISOString()}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl p-4 ${isNight ? 'bg-night-card' : 'bg-white shadow-sm'}`}
          >
            <p className="text-sm font-medium mb-2">
              {format(selectedDate, 'M月d日 EEEE', { locale: zhCN })}
            </p>
            {getAnniversaryForDate(selectedDate).length > 0 ? (
              <div className="space-y-2">
                {getAnniversaryForDate(selectedDate).map(a => (
                  <div key={a.id} className="flex items-center gap-2">
                    <span>{a.emoji}</span>
                    <span className="text-sm">{a.title}</span>
                    {a.recurring && (
                      <span className="text-[10px] opacity-40">每年</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs opacity-30">没有纪念日</p>
            )}
          </motion.div>
        )}

        {/* Add anniversary */}
        {showAddForm ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-2xl p-4 space-y-3 ${isNight ? 'bg-night-card' : 'bg-white shadow-sm'}`}
          >
            <p className="text-sm font-medium">添加纪念日</p>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="名称"
              className="w-full text-sm bg-transparent outline-none border-b border-current/10 py-1"
            />
            <div className="flex gap-2">
              <input
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                className="flex-1 text-sm bg-transparent outline-none border-b border-current/10 py-1"
              />
              <select
                value={newEmoji}
                onChange={(e) => setNewEmoji(e.target.value)}
                className="text-sm bg-transparent outline-none"
              >
                {['❤️', '🎂', '🌸', '🐆', '🦦', '💍', '🎄', '🎉', '🐾'].map(e => (
                  <option key={e} value={e}>{e}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={newRecurring}
                onChange={(e) => setNewRecurring(e.target.checked)}
              />
              每年重复
            </label>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowAddForm(false)} className="text-xs opacity-50">取消</button>
              <button
                onClick={handleAddAnniversary}
                className={`px-3 py-1 rounded-lg text-xs ${
                  isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'
                }`}
              >
                保存
              </button>
            </div>
          </motion.div>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className={`w-full py-3 rounded-2xl text-sm transition ${
              isNight
                ? 'bg-night-card hover:bg-night-surface text-night-muted'
                : 'bg-white shadow-sm hover:shadow-md text-day-muted'
            }`}
          >
            + 添加纪念日
          </button>
        )}
      </div>
    </div>
  )
}
