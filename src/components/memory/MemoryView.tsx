'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────
interface Bucket {
  id: string
  name: string
  type: string
  domain: string[]
  tags: string[]
  valence: number
  arousal: number
  importance: number
  resolved: boolean
  protected: boolean
  highlight: boolean
  pinned: boolean
  internalized: boolean
  event_time: string
  created: string
  last_active: string
  activation_count: number
  score: number
  summary: string
  content_preview: string
}

// ─── Tab definitions ──────────────────────────────────────────
type TabKey = 'clusters' | 'nodes' | 'lines' | 'evolution'
const TABS: { key: TabKey; label: string; num: string }[] = [
  { key: 'clusters', num: '01', label: '团块' },
  { key: 'nodes', num: '02', label: '端点' },
  { key: 'lines', num: '03', label: '连线' },
  { key: 'evolution', num: '04', label: '演变' },
]

// ─── Relation extraction from tags ────────────────────────────
// Try to extract subject-relation patterns from tags
const RELATION_WORDS = [
  '做了', '是', '说过', '想要', '喜欢', '拥有', '经历了', '袒露', '害怕',
  '提出', '承诺', '去过', '发现', '有', '买了', '讨厌', '承认', '告诉',
  '学过', '拒绝', '画了', '梦到', '做过', '需要',
]

function extractRelation(bucket: Bucket): string {
  // Check tags for relation words
  for (const tag of bucket.tags) {
    for (const rel of RELATION_WORDS) {
      if (tag.includes(rel)) return rel
    }
  }
  // Fallback: derive from domain or type
  if (bucket.type === 'feel') return '感受'
  if (bucket.type === 'permanent') return '记住'
  if (bucket.resolved) return '经历了'
  return '记录'
}

// ─── Main Component ───────────────────────────────────────────
export function MemoryView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const [activeTab, setActiveTab] = useState<TabKey>('clusters')
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [selectedBucket, setSelectedBucket] = useState<Bucket | null>(null)
  const [detailContent, setDetailContent] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)

  // Fetch all buckets
  const fetchBuckets = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/memory/pulse', { method: 'POST' })
      const data = await res.json()
      if (Array.isArray(data)) {
        setBuckets(data)
      }
    } catch (err) {
      console.error('Failed to fetch buckets:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchBuckets() }, [fetchBuckets])

  // Search
  const searchBuckets = useCallback(async (q: string) => {
    if (!q.trim()) { fetchBuckets(); return }
    setLoading(true)
    try {
      const res = await fetch('/api/memory/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, limit: 50, include_vector: true }),
      })
      const data = await res.json()
      const hits = [...(data.keyword_hits || []), ...(data.vector_hits || [])]
      // Dedupe by id
      const seen = new Set<string>()
      const unique = hits.filter((h: any) => {
        if (seen.has(h.id)) return false
        seen.add(h.id)
        return true
      })
      setBuckets(unique.map((h: any) => ({
        id: h.id, name: h.name, type: h.type || 'dynamic',
        domain: h.domain || [], tags: h.tags || [],
        valence: h.valence ?? 0.5, arousal: h.arousal ?? 0.3,
        importance: h.importance ?? 5, resolved: h.resolved ?? false,
        protected: h.protected ?? false, highlight: h.highlight ?? false,
        pinned: h.pinned ?? false, internalized: h.internalized ?? false,
        event_time: h.event_time || '', created: h.created || '',
        last_active: h.last_active || '', activation_count: h.activation_count ?? 0,
        score: h.score ?? h.similarity ?? 0,
        summary: h.summary || '', content_preview: h.content_preview || '',
      })))
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [fetchBuckets])

  // Fetch detail
  const openDetail = useCallback(async (b: Bucket) => {
    setSelectedBucket(b)
    setDetailContent(b.content_preview)
    setDetailLoading(true)
    try {
      const res = await fetch('/api/memory/bucket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket_id: b.id }),
      })
      const data = await res.json()
      if (data.content) setDetailContent(data.content)
    } catch { /* ignore */ } finally { setDetailLoading(false) }
  }, [])

  // Filter buckets by query (client-side for non-search tabs)
  const filteredBuckets = useMemo(() => {
    if (!query.trim()) return buckets
    const q = query.toLowerCase()
    return buckets.filter(b =>
      b.name.toLowerCase().includes(q) ||
      b.content_preview.toLowerCase().includes(q) ||
      b.tags.some(t => t.toLowerCase().includes(q)) ||
      b.domain.some(d => d.toLowerCase().includes(q))
    )
  }, [buckets, query])

  const accent = isNight ? 'text-night-amber' : 'text-day-pink'
  const accentBg = isNight ? 'bg-night-amber/15' : 'bg-day-pinkLight'
  const cardBg = isNight ? 'bg-night-card' : 'bg-white'
  const surfaceBg = isNight ? 'bg-night-surface' : 'bg-gray-50'
  const mutedText = isNight ? 'text-night-muted' : 'text-day-muted'
  const borderColor = isNight ? 'border-night-border' : 'border-day-border'

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className={`px-4 pt-3 pb-1 flex items-center gap-1 border-b ${borderColor}`}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-3 py-1.5 text-xs rounded-lg transition-all ${
              activeTab === tab.key
                ? `${accentBg} ${accent} font-medium`
                : `${mutedText} hover:opacity-70`
            }`}
          >
            <span className="opacity-50 mr-1">{tab.num}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="px-4 py-2">
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${surfaceBg}`}>
          <Search size={14} className="opacity-30" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchBuckets(query)}
            placeholder="搜索记忆..."
            className="flex-1 bg-transparent outline-none text-xs placeholder:opacity-30"
          />
          {query && (
            <button onClick={() => { setQuery(''); fetchBuckets() }}>
              <X size={12} className="opacity-40" />
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <div className={`text-center py-12 text-sm ${mutedText}`}>加载中...</div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
            >
              {activeTab === 'clusters' && (
                <ClustersTab buckets={filteredBuckets} isNight={isNight} onSelect={openDetail} />
              )}
              {activeTab === 'nodes' && (
                <NodesTab buckets={filteredBuckets} isNight={isNight} onSelect={openDetail} />
              )}
              {activeTab === 'lines' && (
                <LinesTab buckets={filteredBuckets} isNight={isNight} onSelect={openDetail} />
              )}
              {activeTab === 'evolution' && (
                <EvolutionTab buckets={filteredBuckets} isNight={isNight} onSelect={openDetail} />
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Detail panel */}
      <AnimatePresence>
        {selectedBucket && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25 }}
            className={`absolute bottom-0 left-0 right-0 rounded-t-2xl p-5 max-h-[65%] overflow-y-auto z-30 ${cardBg} ${
              isNight ? '' : 'shadow-lg'
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-sm truncate">{selectedBucket.name}</h3>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {selectedBucket.domain.map(d => (
                    <span key={d} className={`text-[10px] px-1.5 py-0.5 rounded ${accentBg} ${accent}`}>{d}</span>
                  ))}
                  {selectedBucket.tags.slice(0, 6).map(t => (
                    <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded ${surfaceBg} ${mutedText}`}>{t}</span>
                  ))}
                </div>
              </div>
              <button onClick={() => setSelectedBucket(null)} className="p-1 ml-2">
                <X size={16} className="opacity-40" />
              </button>
            </div>

            {selectedBucket.summary && (
              <p className={`text-xs mb-2 ${mutedText} italic`}>{selectedBucket.summary}</p>
            )}

            <p className="text-xs leading-relaxed opacity-80 whitespace-pre-wrap">
              {detailLoading ? '加载中...' : detailContent}
            </p>

            <div className={`flex flex-wrap gap-3 mt-4 text-[10px] ${mutedText}`}>
              <span>重要性 {selectedBucket.importance}</span>
              <span>V{selectedBucket.valence.toFixed(1)}</span>
              <span>A{selectedBucket.arousal.toFixed(1)}</span>
              <span>权重 {selectedBucket.score.toFixed(1)}</span>
              {selectedBucket.event_time && <span>{selectedBucket.event_time.slice(0, 10)}</span>}
              {selectedBucket.pinned && <span>📌</span>}
              {selectedBucket.resolved && <span>✅已解决</span>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Tab 1: Clusters (团块) ───────────────────────────────────
function ClustersTab({ buckets, isNight, onSelect }: {
  buckets: Bucket[]; isNight: boolean; onSelect: (b: Bucket) => void
}) {
  const [expandedDomain, setExpandedDomain] = useState<string | null>(null)
  const accent = isNight ? 'text-night-amber' : 'text-day-pink'
  const accentBg = isNight ? 'bg-night-amber/10' : 'bg-day-pinkLight/60'
  const cardBg = isNight ? 'bg-night-card' : 'bg-white'
  const surfaceBg = isNight ? 'bg-night-surface' : 'bg-gray-50'
  const mutedText = isNight ? 'text-night-muted' : 'text-day-muted'
  const borderColor = isNight ? 'border-night-border' : 'border-day-border'

  // Group by domain
  const clusters = useMemo(() => {
    const map = new Map<string, Bucket[]>()
    for (const b of buckets) {
      const domains = b.domain.length > 0 ? b.domain : ['未分类']
      for (const d of domains) {
        if (!map.has(d)) map.set(d, [])
        map.get(d)!.push(b)
      }
    }
    return Array.from(map.entries())
      .map(([domain, items]) => ({
        domain,
        items: items.sort((a, b) => b.score - a.score),
        totalScore: items.reduce((s, i) => s + i.score, 0),
        tags: Array.from(new Set(items.flatMap(i => i.tags))).slice(0, 8),
      }))
      .sort((a, b) => b.items.length - a.items.length)
  }, [buckets])

  if (clusters.length === 0) {
    return <div className={`text-center py-12 text-sm ${mutedText}`}>暂无记忆</div>
  }

  return (
    <div className="space-y-2">
      {clusters.map(cluster => {
        const isExpanded = expandedDomain === cluster.domain
        return (
          <div key={cluster.domain} className={`rounded-xl overflow-hidden border ${borderColor}`}>
            {/* Cluster header */}
            <button
              onClick={() => setExpandedDomain(isExpanded ? null : cluster.domain)}
              className={`w-full px-3 py-2.5 flex items-center gap-2 text-left ${
                isExpanded ? accentBg : surfaceBg
              }`}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${isExpanded ? accent : ''}`}>
                    {cluster.domain}
                  </span>
                  <span className={`text-[10px] ${mutedText}`}>
                    {cluster.items.length} 条
                  </span>
                </div>
                {!isExpanded && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {cluster.tags.slice(0, 5).map(t => (
                      <span key={t} className={`text-[9px] px-1 py-0.5 rounded ${surfaceBg} ${mutedText}`}>
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </button>

            {/* Cluster body (expanded) */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: 'auto' }}
                  exit={{ height: 0 }}
                  className="overflow-hidden"
                >
                  <div className={`px-3 py-2 space-y-1 ${cardBg}`}>
                    {/* Tags cloud */}
                    <div className="flex flex-wrap gap-1 mb-2">
                      {cluster.tags.map(t => (
                        <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full ${surfaceBg} ${mutedText}`}>
                          {t}
                        </span>
                      ))}
                    </div>

                    {/* Memory entries */}
                    {cluster.items.map(item => (
                      <BucketRow key={item.id} bucket={item} isNight={isNight} onSelect={onSelect} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

// ─── Tab 2: Nodes (端点) ──────────────────────────────────────
function NodesTab({ buckets, isNight, onSelect }: {
  buckets: Bucket[]; isNight: boolean; onSelect: (b: Bucket) => void
}) {
  const mutedText = isNight ? 'text-night-muted' : 'text-day-muted'

  if (buckets.length === 0) {
    return <div className={`text-center py-12 text-sm ${mutedText}`}>暂无记忆</div>
  }

  return (
    <div className="space-y-1">
      {buckets.map(b => (
        <BucketRow key={b.id} bucket={b} isNight={isNight} onSelect={onSelect} showDomain />
      ))}
    </div>
  )
}

// ─── Tab 3: Lines (连线) ──────────────────────────────────────
function LinesTab({ buckets, isNight, onSelect }: {
  buckets: Bucket[]; isNight: boolean; onSelect: (b: Bucket) => void
}) {
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const accent = isNight ? 'text-night-amber' : 'text-day-pink'
  const accentBg = isNight ? 'bg-night-amber/15' : 'bg-day-pinkLight'
  const surfaceBg = isNight ? 'bg-night-surface' : 'bg-gray-50'
  const mutedText = isNight ? 'text-night-muted' : 'text-day-muted'
  const cardBg = isNight ? 'bg-night-card' : 'bg-white'
  const borderColor = isNight ? 'border-night-border' : 'border-day-border'

  // Count tags
  const tagCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of buckets) {
      for (const t of b.tags) {
        map.set(t, (map.get(t) || 0) + 1)
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
  }, [buckets])

  // Filter buckets by selected tag
  const filtered = useMemo(() => {
    if (!selectedTag) return []
    return buckets.filter(b => b.tags.includes(selectedTag))
  }, [buckets, selectedTag])

  if (buckets.length === 0) {
    return <div className={`text-center py-12 text-sm ${mutedText}`}>暂无记忆</div>
  }

  return (
    <div>
      {/* Tag description */}
      <p className={`text-[10px] ${mutedText} mb-2`}>
        线的名字（横切维度，跨主题）· 点了过滤
      </p>

      {/* Tag cloud */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {tagCounts.map(([tag, count]) => (
          <button
            key={tag}
            onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
            className={`text-[11px] px-2 py-1 rounded-full transition-all ${
              selectedTag === tag
                ? `${accentBg} ${accent} ring-1 ${isNight ? 'ring-night-amber/30' : 'ring-day-pink/30'}`
                : `${surfaceBg} ${mutedText} hover:opacity-70`
            }`}
          >
            {tag} <span className="opacity-50">{count}</span>
          </button>
        ))}
      </div>

      {/* Selected tag results */}
      {selectedTag && (
        <div className={`rounded-xl border ${borderColor} overflow-hidden`}>
          <div className={`px-3 py-2 ${accentBg}`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs ${accent}`}>关系：{selectedTag}</span>
              <button onClick={() => setSelectedTag(null)}>
                <X size={12} className="opacity-40" />
              </button>
            </div>
          </div>
          <div className={`px-3 py-2 space-y-1 ${cardBg}`}>
            {filtered.map(b => (
              <BucketRow key={b.id} bucket={b} isNight={isNight} onSelect={onSelect} relationTag={selectedTag} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab 4: Evolution (演变) ──────────────────────────────────
function EvolutionTab({ buckets, isNight, onSelect }: {
  buckets: Bucket[]; isNight: boolean; onSelect: (b: Bucket) => void
}) {
  const mutedText = isNight ? 'text-night-muted' : 'text-day-muted'
  const borderColor = isNight ? 'border-night-border' : 'border-day-border'
  const accent = isNight ? 'text-night-amber' : 'text-day-pink'

  // Group by date
  const timeline = useMemo(() => {
    const sorted = [...buckets].sort((a, b) => {
      const da = a.event_time || a.created
      const db = b.event_time || b.created
      return db.localeCompare(da)
    })
    const groups = new Map<string, Bucket[]>()
    for (const b of sorted) {
      const date = (b.event_time || b.created || '').slice(0, 10) || '未知日期'
      if (!groups.has(date)) groups.set(date, [])
      groups.get(date)!.push(b)
    }
    return Array.from(groups.entries())
  }, [buckets])

  if (buckets.length === 0) {
    return <div className={`text-center py-12 text-sm ${mutedText}`}>暂无记忆</div>
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className={`absolute left-[7px] top-0 bottom-0 w-px ${
        isNight ? 'bg-night-border' : 'bg-day-border'
      }`} />

      <div className="space-y-4">
        {timeline.map(([date, items]) => (
          <div key={date} className="relative pl-6">
            {/* Dot */}
            <div className={`absolute left-0 top-1 w-[15px] h-[15px] rounded-full border-2 ${
              isNight ? 'border-night-amber bg-night-bg' : 'border-day-pink bg-day-bg'
            }`} />

            {/* Date label */}
            <div className={`text-[10px] ${accent} font-medium mb-1.5`}>{date}</div>

            {/* Items */}
            <div className="space-y-1">
              {items.map(b => (
                <BucketRow key={b.id} bucket={b} isNight={isNight} onSelect={onSelect} showDomain compact />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Shared BucketRow component ───────────────────────────────
function BucketRow({ bucket, isNight, onSelect, showDomain, compact, relationTag }: {
  bucket: Bucket; isNight: boolean; onSelect: (b: Bucket) => void
  showDomain?: boolean; compact?: boolean; relationTag?: string
}) {
  const accent = isNight ? 'text-night-amber' : 'text-day-pink'
  const accentBg = isNight ? 'bg-night-amber/10' : 'bg-day-pinkLight/60'
  const surfaceBg = isNight ? 'bg-night-surface' : 'bg-gray-50'
  const mutedText = isNight ? 'text-night-muted' : 'text-day-muted'

  const relation = relationTag || extractRelation(bucket)
  const icon = bucket.pinned ? '📌' : bucket.type === 'feel' ? '🫧' : bucket.resolved ? '✅' : '她'

  return (
    <button
      onClick={() => onSelect(bucket)}
      className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors hover:${
        isNight ? 'bg-night-surface/60' : 'bg-gray-50'
      } ${compact ? 'py-1.5' : ''}`}
    >
      <div className="flex items-center gap-2">
        {/* Subject + relation */}
        <span className={`text-[11px] flex-shrink-0 ${
          typeof icon === 'string' && icon.length <= 2 ? 'w-5 text-center' : ''
        }`}>
          {icon}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${accentBg} ${accent} flex-shrink-0`}>
          {relation}
        </span>

        {/* Name */}
        <span className="text-xs flex-1 min-w-0 truncate">
          {bucket.name}
        </span>

        {/* Score */}
        <span className={`text-[10px] flex-shrink-0 ${mutedText}`}>
          {bucket.valence.toFixed(1)}
        </span>
      </div>

      {/* Domain chips */}
      {showDomain && bucket.domain.length > 0 && (
        <div className="flex gap-1 mt-1 ml-7">
          {bucket.domain.map(d => (
            <span key={d} className={`text-[9px] px-1 py-0.5 rounded ${surfaceBg} ${mutedText}`}>
              {d}
            </span>
          ))}
        </div>
      )}

      {/* Expandable content preview (shown under cluster view) */}
      {bucket.summary && !compact && (
        <p className={`text-[10px] ${mutedText} mt-1 ml-7 line-clamp-2`}>
          {bucket.summary || bucket.content_preview}
        </p>
      )}
    </button>
  )
}
