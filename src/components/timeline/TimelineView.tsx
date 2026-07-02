'use client'

import { useState, useEffect } from 'react'
import { useTheme } from '@/lib/theme'
import { useApp } from '@/lib/store'
import { motion } from 'framer-motion'
import { Lock, BookOpen, Brain, MessageSquare, ChevronDown } from 'lucide-react'

interface TimelineEntry {
  type: 'diary' | 'memory'
  id: string
  date: string
  title: string
  preview: string
  author?: 'star' | 'fire'
  locked?: boolean
  pinned?: boolean
  importance?: number
  tags?: string[]
}

export function TimelineView() {
  const { theme } = useTheme()
  const { currentUser } = useApp()
  const isNight = theme === 'night'

  const [entries, setEntries] = useState<TimelineEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'diary' | 'memory'>('all')

  useEffect(() => {
    loadTimeline()
  }, [])

  const loadTimeline = async () => {
    setLoading(true)
    try {
      const [diaryRes, memoryRes] = await Promise.all([
        fetch('/api/diary/timeline', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ viewer: currentUser, limit: 50 }),
        }),
        fetch('/api/memory/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ importance_min: 3 }),
        }),
      ])

      const diaryData = await diaryRes.json()
      const memoryData = await memoryRes.json()

      const diaryEntries: TimelineEntry[] = (diaryData.entries || []).map((d: any) => ({
        type: 'diary' as const,
        id: d.time_id || d.date,
        date: d.date,
        title: d.title || '无题',
        preview: d.locked ? '🔒 需要密码解锁' : (d.content?.slice(0, 100) || ''),
        author: d.author,
        locked: d.locked,
        tags: d.tags,
      }))

      const memoryEntries: TimelineEntry[] = (memoryData.results || []).map((m: any) => ({
        type: 'memory' as const,
        id: m.id,
        date: m.created_at || '',
        title: m.name || '记忆片段',
        preview: m.content?.slice(0, 100) || '',
        pinned: m.pinned,
        importance: m.importance,
        tags: m.tags,
      }))

      const all = [...diaryEntries, ...memoryEntries].sort((a, b) =>
        new Date(b.date).getTime() - new Date(a.date).getTime()
      )

      setEntries(all)
    } catch (err) {
      console.error('Timeline load failed', err)
    } finally {
      setLoading(false)
    }
  }

  const filtered = filter === 'all' ? entries : entries.filter(e => e.type === filter)

  // Group by month
  const grouped = filtered.reduce((acc, entry) => {
    const month = entry.date?.slice(0, 7) || 'unknown'
    if (!acc[month]) acc[month] = []
    acc[month].push(entry)
    return acc
  }, {} as Record<string, TimelineEntry[]>)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between">
        <h2 className="text-lg font-medium">🕐 时间轴</h2>
        <div className={`flex gap-1 p-1 rounded-xl ${
          isNight ? 'bg-night-surface' : 'bg-gray-100'
        }`}>
          {(['all', 'diary', 'memory'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1 rounded-lg text-xs transition-all ${
                filter === f
                  ? isNight
                    ? 'bg-night-amber/20 text-night-amber'
                    : 'bg-white text-day-pink shadow-sm'
                  : 'opacity-50'
              }`}
            >
              {f === 'all' ? '全部' : f === 'diary' ? '📔 日记' : '🧠 记忆'}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-6 pb-20">
        {loading ? (
          <div className="text-center py-12 opacity-30">加载中...</div>
        ) : Object.keys(grouped).length === 0 ? (
          <div className="text-center py-12 opacity-30">
            <p className="text-3xl mb-2">🕐</p>
            <p className="text-sm">还没有时间线条目</p>
          </div>
        ) : (
          Object.entries(grouped).map(([month, items]) => (
            <div key={month} className="mb-8">
              {/* Month header */}
              <div className={`text-xs font-medium mb-4 px-2 ${
                isNight ? 'text-night-amber' : 'text-day-pink'
              }`}>
                {month}
              </div>

              {/* Items */}
              <div className="relative">
                {/* Vertical line */}
                <div className={`absolute left-[15px] top-0 bottom-0 w-px ${
                  isNight ? 'bg-night-border' : 'bg-gray-200'
                }`} />

                {items.map((entry, i) => (
                  <motion.div
                    key={entry.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="relative flex gap-4 mb-4"
                  >
                    {/* Dot */}
                    <div className={`relative z-10 w-[31px] flex-shrink-0 flex justify-center pt-1`}>
                      <div className={`w-3 h-3 rounded-full border-2 ${
                        entry.type === 'diary'
                          ? entry.author === 'star'
                            ? isNight ? 'bg-night-amber border-night-amber' : 'bg-day-pink border-day-pink'
                            : isNight ? 'bg-night-surface border-night-amber' : 'bg-day-sky border-day-sky'
                          : entry.pinned
                            ? isNight ? 'bg-night-amber border-night-amber' : 'bg-day-heart border-day-heart'
                            : isNight ? 'bg-night-surface border-night-muted' : 'bg-gray-200 border-gray-300'
                      }`} />
                    </div>

                    {/* Card */}
                    <div className={`flex-1 p-3 rounded-xl ${
                      isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        {entry.type === 'diary' ? (
                          entry.locked ? <Lock size={12} className="opacity-40" /> : <BookOpen size={12} className="opacity-40" />
                        ) : (
                          <Brain size={12} className="opacity-40" />
                        )}
                        <span className="text-[10px] opacity-40">{entry.date?.slice(0, 10)}</span>
                        {entry.author && (
                          <span className="text-[10px] opacity-40">
                            {entry.author === 'star' ? '⭐' : '🔥'}
                          </span>
                        )}
                      </div>
                      <h4 className="text-sm font-medium mb-1">{entry.title}</h4>
                      <p className="text-xs opacity-50 line-clamp-2">{entry.preview}</p>
                      {entry.tags && entry.tags.length > 0 && (
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {entry.tags.slice(0, 4).map(tag => (
                            <span key={tag} className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                              isNight ? 'bg-night-card text-night-muted' : 'bg-gray-100 text-gray-400'
                            }`}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
