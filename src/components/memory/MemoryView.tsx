'use client'

import { useState, useEffect } from 'react'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Pin, X } from 'lucide-react'

interface MemoryBucket {
  id: string
  name: string
  content: string
  tags: string[]
  domain: string
  importance: number
  valence: number
  arousal: number
  pinned: boolean
  created_at: string
}

export function MemoryView() {
  const { theme } = useTheme()
  const [query, setQuery] = useState('')
  const [memories, setMemories] = useState<MemoryBucket[]>([])
  const [selected, setSelected] = useState<MemoryBucket | null>(null)
  const [loading, setLoading] = useState(false)

  const isNight = theme === 'night'

  const search = async (q?: string) => {
    setLoading(true)
    try {
      const res = await fetch('/api/memory/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q || undefined }),
      })
      const data = await res.json()
      if (data.results) setMemories(data.results)
    } catch (err) {
      console.error('Memory search failed', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    search()
  }, [])

  // Map importance to node size
  const getNodeSize = (importance: number) => {
    const base = 40
    return base + importance * 8
  }

  // Map valence to color
  const getNodeColor = (valence: number, arousal: number) => {
    if (isNight) {
      if (valence > 0.7) return 'bg-night-amber/40 border-night-amber'
      if (valence > 0.4) return 'bg-night-surface border-night-amber/30'
      return 'bg-night-surface border-night-muted/30'
    } else {
      if (valence > 0.7) return 'bg-day-honey/50 border-day-pink'
      if (valence > 0.4) return 'bg-day-sky/40 border-day-sky'
      return 'bg-gray-100 border-gray-200'
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Search bar */}
      <div className="px-6 py-4">
        <div className={`flex items-center gap-2 px-4 py-2 rounded-xl ${
          isNight ? 'bg-night-surface' : 'bg-gray-50'
        }`}>
          <Search size={16} className="opacity-40" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search(query)}
            placeholder="搜索记忆..."
            className={`flex-1 bg-transparent outline-none text-sm ${
              isNight ? 'placeholder:text-night-muted' : 'placeholder:text-day-muted'
            }`}
          />
        </div>
      </div>

      {/* Memory nodes - visual graph */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="text-center py-12 opacity-30">搜索中...</div>
        ) : memories.length === 0 ? (
          <div className="text-center py-12 opacity-30 space-y-2">
            <span className="text-3xl">🧠</span>
            <p className="text-sm">记忆宫殿</p>
            <p className="text-xs">输入关键词探索</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 justify-center">
            {memories.map((mem, i) => {
              const size = getNodeSize(mem.importance)
              return (
                <motion.button
                  key={mem.id}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: i * 0.05 }}
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setSelected(mem)}
                  className={`
                    relative rounded-full border-2 flex items-center justify-center
                    transition-all cursor-pointer
                    ${getNodeColor(mem.valence, mem.arousal)}
                  `}
                  style={{
                    width: `${size}px`,
                    height: `${size}px`,
                  }}
                >
                  {mem.pinned && (
                    <Pin size={10} className={`absolute -top-1 -right-1 ${
                      isNight ? 'text-night-amber' : 'text-day-heart'
                    }`} />
                  )}
                  <span className="text-[9px] px-1 text-center leading-tight truncate">
                    {mem.name}
                  </span>
                </motion.button>
              )
            })}
          </div>
        )}
      </div>

      {/* Selected memory detail */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25 }}
            className={`
              absolute bottom-0 left-0 right-0
              rounded-t-3xl p-6 max-h-[60%] overflow-y-auto
              ${isNight ? 'bg-night-card' : 'bg-white shadow-lg'}
            `}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-medium">{selected.name}</h3>
                <div className="flex gap-1 mt-1 flex-wrap">
                  {selected.tags?.map(tag => (
                    <span key={tag} className={`text-[10px] px-2 py-0.5 rounded-full ${
                      isNight ? 'bg-night-surface text-night-muted' : 'bg-gray-100 text-day-muted'
                    }`}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
              <button onClick={() => setSelected(null)} className="p-1">
                <X size={16} />
              </button>
            </div>
            <p className="text-sm leading-relaxed opacity-80 whitespace-pre-wrap">
              {selected.content}
            </p>
            <div className="flex gap-4 mt-4 text-[10px] opacity-40">
              <span>重要性: {selected.importance}</span>
              <span>情感: {(selected.valence * 100).toFixed(0)}%</span>
              <span>{selected.domain}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
