'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Pin, X, SlidersHorizontal } from 'lucide-react'

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
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({
    domain: '',
    minImportance: 1,
    minValence: 0,
    minArousal: 0,
  })
  const svgRef = useRef<SVGSVGElement>(null)
  const nodesRef = useRef<Map<string, DOMRect>>(new Map())
  const containerRef = useRef<HTMLDivElement>(null)

  const isNight = theme === 'night'

  const search = async (q?: string) => {
    setLoading(true)
    try {
      const body: any = {}
      if (q) body.query = q
      if (filters.domain) body.domain = filters.domain
      if (filters.minImportance > 1) body.importance_min = filters.minImportance

      const res = await fetch('/api/memory/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      let results = data.results || []

      // Client-side filters
      if (filters.minValence > 0) {
        results = results.filter((m: MemoryBucket) => m.valence >= filters.minValence)
      }
      if (filters.minArousal > 0) {
        results = results.filter((m: MemoryBucket) => m.arousal >= filters.minArousal)
      }

      setMemories(results)
    } catch (err) {
      console.error('Memory search failed', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { search() }, [])

  // Connection lines: connect nodes that share tags or domain
  const getConnections = useCallback(() => {
    const connections: { from: string; to: string; strength: number }[] = []
    for (let i = 0; i < memories.length; i++) {
      for (let j = i + 1; j < memories.length; j++) {
        const a = memories[i]
        const b = memories[j]
        let strength = 0

        // Same domain
        if (a.domain && b.domain && a.domain === b.domain) strength += 1

        // Shared tags
        const sharedTags = (a.tags || []).filter(t => (b.tags || []).includes(t))
        strength += sharedTags.length

        if (strength > 0) {
          connections.push({ from: a.id, to: b.id, strength: Math.min(strength, 3) })
        }
      }
    }
    return connections.slice(0, 30) // limit for performance
  }, [memories])

  const getNodeSize = (importance: number) => 40 + importance * 8
  const getNodeColor = (valence: number) => {
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

  // Available domains from results
  const domains = Array.from(new Set(memories.map(m => m.domain).filter(Boolean)))

  return (
    <div className="h-full flex flex-col relative">
      {/* Search bar + filter toggle */}
      <div className="px-6 py-4 space-y-2">
        <div className="flex gap-2">
          <div className={`flex-1 flex items-center gap-2 px-4 py-2 rounded-xl ${
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
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`p-2 rounded-xl transition-colors ${
              showFilters
                ? isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-day-pink/20 text-day-pink'
                : isNight ? 'bg-night-surface text-night-muted' : 'bg-gray-50 text-gray-400'
            }`}
          >
            <SlidersHorizontal size={18} />
          </button>
        </div>

        {/* Filter panel */}
        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className={`p-3 rounded-xl space-y-3 ${
                isNight ? 'bg-night-surface' : 'bg-gray-50'
              }`}>
                {/* Domain filter */}
                <div>
                  <label className="text-[10px] opacity-40 block mb-1">域</label>
                  <div className="flex flex-wrap gap-1">
                    <button
                      onClick={() => setFilters(f => ({ ...f, domain: '' }))}
                      className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                        !filters.domain
                          ? isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-day-pink/20 text-day-pink'
                          : 'opacity-40'
                      }`}
                    >全部</button>
                    {domains.map(d => (
                      <button
                        key={d}
                        onClick={() => setFilters(f => ({ ...f, domain: d }))}
                        className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                          filters.domain === d
                            ? isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-day-pink/20 text-day-pink'
                            : 'opacity-40'
                        }`}
                      >{d}</button>
                    ))}
                  </div>
                </div>

                {/* Importance slider */}
                <div>
                  <label className="text-[10px] opacity-40 block mb-1">
                    最低重要性: {filters.minImportance}
                  </label>
                  <input
                    type="range" min={1} max={10} step={1}
                    value={filters.minImportance}
                    onChange={e => setFilters(f => ({ ...f, minImportance: +e.target.value }))}
                    className="w-full h-1 rounded-full appearance-none cursor-pointer accent-current"
                  />
                </div>

                {/* Valence slider */}
                <div>
                  <label className="text-[10px] opacity-40 block mb-1">
                    最低情感: {(filters.minValence * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range" min={0} max={1} step={0.1}
                    value={filters.minValence}
                    onChange={e => setFilters(f => ({ ...f, minValence: +e.target.value }))}
                    className="w-full h-1 rounded-full appearance-none cursor-pointer accent-current"
                  />
                </div>

                <button
                  onClick={() => search(query)}
                  className={`w-full py-1.5 rounded-lg text-xs ${
                    isNight ? 'bg-night-amber/20 text-night-amber' : 'bg-day-pink/20 text-day-pink'
                  }`}
                >
                  应用筛选
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Memory graph */}
      <div ref={containerRef} className="flex-1 overflow-y-auto px-6 pb-6 relative">
        {/* SVG connection lines */}
        <svg
          ref={svgRef}
          className="absolute inset-0 pointer-events-none"
          style={{ width: '100%', height: '100%' }}
        >
          {getConnections().map((conn, i) => {
            const fromEl = nodesRef.current.get(conn.from)
            const toEl = nodesRef.current.get(conn.to)
            const container = containerRef.current?.getBoundingClientRect()
            if (!fromEl || !toEl || !container) return null

            const x1 = fromEl.left - container.left + fromEl.width / 2
            const y1 = fromEl.top - container.top + fromEl.height / 2
            const x2 = toEl.left - container.left + toEl.width / 2
            const y2 = toEl.top - container.top + toEl.height / 2

            return (
              <line
                key={i}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={isNight ? '#e2a84b' : '#F3A4AC'}
                strokeOpacity={0.15 * conn.strength}
                strokeWidth={conn.strength * 0.5}
              />
            )
          })}
        </svg>

        {loading ? (
          <div className="text-center py-12 opacity-30">搜索中...</div>
        ) : memories.length === 0 ? (
          <div className="text-center py-12 opacity-30 space-y-2">
            <span className="text-3xl">🧠</span>
            <p className="text-sm">记忆宫殿</p>
            <p className="text-xs">输入关键词探索</p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 justify-center relative z-10">
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
                  ref={(el) => {
                    if (el) {
                      requestAnimationFrame(() => {
                        nodesRef.current.set(mem.id, el.getBoundingClientRect())
                      })
                    }
                  }}
                  className={`
                    relative rounded-full border-2 flex items-center justify-center
                    transition-all cursor-pointer
                    ${getNodeColor(mem.valence)}
                  `}
                  style={{ width: `${size}px`, height: `${size}px` }}
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

      {/* Detail panel */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25 }}
            className={`
              absolute bottom-0 left-0 right-0
              rounded-t-3xl p-6 max-h-[60%] overflow-y-auto z-20
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
              <span>唤醒: {(selected.arousal * 100).toFixed(0)}%</span>
              <span>{selected.domain}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
