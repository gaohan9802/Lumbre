'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, ChevronDown, ChevronRight, Pin, Check, Trash2, Edit3 } from 'lucide-react'

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
  pinned: boolean
  digested: boolean
  protected: boolean
  highlight: boolean
  internalized: boolean
  event_time: string
  created: string
  last_active: string
  activation_count: number
  model_valence?: number
  summary?: string
  score: number
  content_preview: string
}

interface BreathResult {
  id: string
  name: string
  type: string
  pinned: boolean
  resolved: boolean
  scores: { topic: number; emotion: number; time: number; importance: number }
  weights: { topic: number; emotion: number; time: number; importance: number }
  normalized: number
  passed_threshold: boolean
}

interface NetworkData {
  nodes: { id: string; name: string; type: string; score: number; pinned: boolean; resolved: boolean; domain: string[]; tags: string[] }[]
  edges: { source: string; target: string; similarity: number; shared_tags: string[] }[]
}

// ─── Tab definitions ──────────────────────────────────────────
type TabKey = 'clusters' | 'nodes' | 'lines' | 'evolution' | 'breath' | 'network'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'clusters', label: '团块' },
  { key: 'nodes', label: '端点' },
  { key: 'lines', label: '连线' },
  { key: 'evolution', label: '演变' },
  { key: 'breath', label: '呼吸' },
  { key: 'network', label: '网络' },
]

// ─── Filter definitions ──────────────────────────────────────
const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pinned', label: '📌' },
  { key: 'feel', label: '🫧' },
  { key: 'unresolved', label: '⚡' },
  { key: 'digested', label: '🌿' },
  { key: 'archived', label: '📦' },
]

// ─── Relation extraction from tags ────────────────────────────
const RELATION_WORDS = [
  '做了', '是', '说过', '想要', '喜欢', '拥有', '经历了', '袒露', '害怕',
  '提出', '承诺', '去过', '发现', '有', '买了', '讨厌', '承认', '告诉',
  '学过', '拒绝', '画了', '梦到', '做过', '需要',
]

function extractRelation(bucket: Bucket): string {
  for (const tag of bucket.tags) {
    for (const rel of RELATION_WORDS) {
      if (tag.includes(rel)) return rel
    }
  }
  if (bucket.type === 'feel') return '感受'
  if (bucket.type === 'permanent') return '记住'
  if (bucket.resolved) return '经历了'
  return '记录'
}

function formatTimeAgo(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const now = new Date()
  const hours = Math.floor((now.getTime() - d.getTime()) / 3600000)
  if (hours < 1) return '刚刚'
  if (hours < 24) return hours + 'h前'
  const days = Math.floor(hours / 24)
  if (days < 30) return days + 'd前'
  return Math.floor(days / 30) + 'mo前'
}

// ─── Main Component ───────────────────────────────────────────
export function MemoryView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const [activeTab, setActiveTab] = useState<TabKey>('clusters')
  const [buckets, setBuckets] = useState<Bucket[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedBucket, setSelectedBucket] = useState<Bucket | null>(null)
  const [detailContent, setDetailContent] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [stats, setStats] = useState({ total: 0, pinned: 0, feel: 0, resolved: 0 })

  // Fetch all buckets
  const fetchBuckets = useCallback(async (f?: string) => {
    setLoading(true)
    try {
      const filterParam = f || filter
      const url = filterParam && filterParam !== 'all'
        ? `/api/memory/buckets?filter=${filterParam}`
        : '/api/memory/buckets'
      const res = await fetch(url)
      const data = await res.json()
      if (Array.isArray(data)) {
        setBuckets(data)
        // Compute stats from unfiltered data
        if (filterParam === 'all' || !filterParam) {
          setStats({
            total: data.length,
            pinned: data.filter((b: Bucket) => b.pinned).length,
            feel: data.filter((b: Bucket) => b.type === 'feel').length,
            resolved: data.filter((b: Bucket) => b.resolved).length,
          })
        }
      }
    } catch (err) {
      console.error('Failed to fetch buckets:', err)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { fetchBuckets() }, [fetchBuckets])

  // Search
  const searchBuckets = useCallback(async (q: string) => {
    if (!q.trim()) { fetchBuckets(); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/memory/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      const hits = [...(data.keyword_hits || []), ...(data.vector_hits || [])]
      const seen = new Set<string>()
      const unique = hits.filter((h: any) => {
        if (seen.has(h.id)) return false
        seen.add(h.id)
        return true
      })
      setBuckets(unique)
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [fetchBuckets])

  // Fetch detail
  const openDetail = useCallback(async (b: Bucket) => {
    setSelectedBucket(b)
    setDetailContent(b.content_preview)
    setDetailLoading(true)
    try {
      const res = await fetch(`/api/memory/bucket?id=${b.id}`)
      const data = await res.json()
      if (data.content) setDetailContent(data.content)
    } catch { /* ignore */ } finally { setDetailLoading(false) }
  }, [])

  // Actions on detail bucket
  const togglePinAction = useCallback(async (id: string) => {
    await fetch(`/api/memory/bucket-pin?id=${id}`, { method: 'POST' })
    fetchBuckets()
    setSelectedBucket(null)
  }, [fetchBuckets])

  const toggleResolveAction = useCallback(async (id: string) => {
    await fetch(`/api/memory/bucket-resolve?id=${id}`, { method: 'POST' })
    fetchBuckets()
    setSelectedBucket(null)
  }, [fetchBuckets])

  const deleteAction = useCallback(async (id: string) => {
    if (!confirm('确认归档？')) return
    await fetch(`/api/memory/bucket-delete?id=${id}`, { method: 'POST' })
    fetchBuckets()
    setSelectedBucket(null)
  }, [fetchBuckets])

  // Filter change
  const handleFilter = useCallback((f: string) => {
    setFilter(f)
    setQuery('')
    fetchBuckets(f)
  }, [fetchBuckets])

  // Client-side filtering for query (within loaded data)
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
      {/* Stats bar */}
      <div className={`px-4 pt-2 pb-1 text-[10px] ${mutedText} flex gap-3`}>
        <span>{stats.total} 桶</span>
        <span>📌 {stats.pinned}</span>
        <span>🫧 {stats.feel}</span>
        <span>✅ {stats.resolved}</span>
      </div>

      {/* Tab bar */}
      <div className={`px-4 pb-1 flex items-center gap-0.5 border-b ${borderColor} overflow-x-auto`}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-2.5 py-1.5 text-[11px] rounded-lg transition-all flex-shrink-0 ${
              activeTab === tab.key
                ? `${accentBg} ${accent} font-medium`
                : `${mutedText} hover:opacity-70`
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filter bar (for browse tabs) */}
      {['clusters', 'nodes', 'lines', 'evolution'].includes(activeTab) && (
        <div className="px-4 py-1.5 flex gap-1 overflow-x-auto">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => handleFilter(f.key)}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-all flex-shrink-0 ${
                filter === f.key
                  ? `${accentBg} ${accent}`
                  : `${surfaceBg} ${mutedText}`
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {/* Search bar */}
      {activeTab !== 'breath' && activeTab !== 'network' && (
        <div className="px-4 py-1.5">
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
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading && activeTab !== 'breath' && activeTab !== 'network' ? (
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
              {activeTab === 'clusters' && <ClustersTab buckets={filteredBuckets} isNight={isNight} onSelect={openDetail} />}
              {activeTab === 'nodes' && <NodesTab buckets={filteredBuckets} isNight={isNight} onSelect={openDetail} />}
              {activeTab === 'lines' && <LinesTab buckets={filteredBuckets} isNight={isNight} onSelect={openDetail} />}
              {activeTab === 'evolution' && <EvolutionTab buckets={filteredBuckets} isNight={isNight} onSelect={openDetail} />}
              {activeTab === 'breath' && <BreathTab isNight={isNight} />}
              {activeTab === 'network' && <NetworkTab isNight={isNight} />}
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
            className={`absolute bottom-0 left-0 right-0 rounded-t-2xl p-5 max-h-[70%] overflow-y-auto z-30 ${cardBg} ${
              isNight ? '' : 'shadow-lg'
            }`}
          >
            {/* Header */}
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

            {/* Summary */}
            {selectedBucket.summary && (
              <p className={`text-xs mb-2 ${mutedText} italic`}>{selectedBucket.summary}</p>
            )}

            {/* Content */}
            <div className={`text-xs leading-relaxed opacity-80 whitespace-pre-wrap rounded-xl p-3 ${surfaceBg} max-h-[40vh] overflow-y-auto`}>
              {detailLoading ? '加载中...' : detailContent}
            </div>

            {/* Metadata grid */}
            <div className={`grid grid-cols-3 gap-2 mt-3 text-[10px] ${mutedText}`}>
              <div>
                <div className="opacity-50">ID</div>
                <div className="font-mono truncate">{selectedBucket.id}</div>
              </div>
              <div>
                <div className="opacity-50">类型</div>
                <div>{selectedBucket.type}</div>
              </div>
              <div>
                <div className="opacity-50">重要性</div>
                <div>{selectedBucket.importance}/10</div>
              </div>
              <div>
                <div className="opacity-50">效价 V</div>
                <div>{selectedBucket.valence.toFixed(2)}</div>
              </div>
              <div>
                <div className="opacity-50">唤醒 A</div>
                <div>{selectedBucket.arousal.toFixed(2)}</div>
              </div>
              <div>
                <div className="opacity-50">权重</div>
                <div>{selectedBucket.score.toFixed(2)}</div>
              </div>
              <div>
                <div className="opacity-50">激活</div>
                <div>{selectedBucket.activation_count}</div>
              </div>
              <div>
                <div className="opacity-50">创建</div>
                <div>{formatTimeAgo(selectedBucket.created)}</div>
              </div>
              <div>
                <div className="opacity-50">活跃</div>
                <div>{formatTimeAgo(selectedBucket.last_active)}</div>
              </div>
            </div>

            {/* Status badges */}
            <div className="flex gap-2 mt-2 text-[10px]">
              {selectedBucket.pinned && <span className={`px-1.5 py-0.5 rounded ${accentBg}`}>📌 钉选</span>}
              {selectedBucket.resolved && <span className={`px-1.5 py-0.5 rounded ${surfaceBg}`}>✅ 已解决</span>}
              {selectedBucket.digested && <span className={`px-1.5 py-0.5 rounded ${surfaceBg}`}>🌿 已消化</span>}
            </div>

            {/* Action buttons */}
            <div className="flex gap-2 mt-3 pt-3 border-t border-current/10">
              <button
                onClick={() => togglePinAction(selectedBucket.id)}
                className={`text-[11px] px-3 py-1.5 rounded-lg ${surfaceBg} flex items-center gap-1`}
              >
                <Pin size={12} /> {selectedBucket.pinned ? '取消钉选' : '钉选'}
              </button>
              <button
                onClick={() => toggleResolveAction(selectedBucket.id)}
                className={`text-[11px] px-3 py-1.5 rounded-lg ${surfaceBg} flex items-center gap-1`}
              >
                <Check size={12} /> {selectedBucket.resolved ? '标未解决' : '标已解决'}
              </button>
              <button
                onClick={() => deleteAction(selectedBucket.id)}
                className={`text-[11px] px-3 py-1.5 rounded-lg ${surfaceBg} flex items-center gap-1 opacity-50`}
              >
                <Trash2 size={12} /> 归档
              </button>
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
        tags: Array.from(new Set(items.flatMap(i => i.tags))).slice(0, 8),
      }))
      .sort((a, b) => b.items.length - a.items.length)
  }, [buckets])

  if (!clusters.length) return <div className={`text-center py-12 text-sm ${mutedText}`}>暂无记忆</div>

  return (
    <div className="space-y-2">
      {clusters.map(cluster => {
        const isExpanded = expandedDomain === cluster.domain
        return (
          <div key={cluster.domain} className={`rounded-xl overflow-hidden border ${borderColor}`}>
            <button
              onClick={() => setExpandedDomain(isExpanded ? null : cluster.domain)}
              className={`w-full px-3 py-2.5 flex items-center gap-2 text-left ${isExpanded ? accentBg : surfaceBg}`}
            >
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${isExpanded ? accent : ''}`}>{cluster.domain}</span>
                  <span className={`text-[10px] ${mutedText}`}>{cluster.items.length} 条</span>
                </div>
                {!isExpanded && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {cluster.tags.slice(0, 5).map(t => (
                      <span key={t} className={`text-[9px] px-1 py-0.5 rounded ${surfaceBg} ${mutedText}`}>{t}</span>
                    ))}
                  </div>
                )}
              </div>
            </button>
            <AnimatePresence>
              {isExpanded && (
                <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                  <div className={`px-3 py-2 space-y-1 ${cardBg}`}>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {cluster.tags.map(t => (
                        <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full ${surfaceBg} ${mutedText}`}>{t}</span>
                      ))}
                    </div>
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
  if (!buckets.length) return <div className={`text-center py-12 text-sm ${mutedText}`}>暂无记忆</div>
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

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const b of buckets) {
      for (const t of b.tags) map.set(t, (map.get(t) || 0) + 1)
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1])
  }, [buckets])

  const filtered = useMemo(() => {
    if (!selectedTag) return []
    return buckets.filter(b => b.tags.includes(selectedTag))
  }, [buckets, selectedTag])

  if (!buckets.length) return <div className={`text-center py-12 text-sm ${mutedText}`}>暂无记忆</div>

  return (
    <div>
      <p className={`text-[10px] ${mutedText} mb-2`}>线的名字（横切维度，跨主题）· 点了过滤</p>
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
      {selectedTag && (
        <div className={`rounded-xl border ${borderColor} overflow-hidden`}>
          <div className={`px-3 py-2 ${accentBg}`}>
            <div className="flex items-center justify-between">
              <span className={`text-xs ${accent}`}>关系：{selectedTag}</span>
              <button onClick={() => setSelectedTag(null)}><X size={12} className="opacity-40" /></button>
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
  const accent = isNight ? 'text-night-amber' : 'text-day-pink'

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

  if (!buckets.length) return <div className={`text-center py-12 text-sm ${mutedText}`}>暂无记忆</div>

  return (
    <div className="relative">
      <div className={`absolute left-[7px] top-0 bottom-0 w-px ${isNight ? 'bg-night-border' : 'bg-day-border'}`} />
      <div className="space-y-4">
        {timeline.map(([date, items]) => (
          <div key={date} className="relative pl-6">
            <div className={`absolute left-0 top-1 w-[15px] h-[15px] rounded-full border-2 ${
              isNight ? 'border-night-amber bg-night-bg' : 'border-day-pink bg-day-bg'
            }`} />
            <div className={`text-[10px] ${accent} font-medium mb-1.5`}>{date}</div>
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

// ─── Tab 5: Breath (呼吸模拟) ─────────────────────────────────
function BreathTab({ isNight }: { isNight: boolean }) {
  const [breathQuery, setBreathQuery] = useState('')
  const [breathValence, setBreathValence] = useState('')
  const [breathArousal, setBreathArousal] = useState('')
  const [breathLoading, setBreathLoading] = useState(false)
  const [breathData, setBreathData] = useState<any>(null)

  const accent = isNight ? 'text-night-amber' : 'text-day-pink'
  const accentBg = isNight ? 'bg-night-amber/15' : 'bg-day-pinkLight'
  const surfaceBg = isNight ? 'bg-night-surface' : 'bg-gray-50'
  const mutedText = isNight ? 'text-night-muted' : 'text-day-muted'
  const borderColor = isNight ? 'border-night-border' : 'border-day-border'

  const barColors: Record<string, string> = {
    topic: isNight ? '#D4A574' : '#E8A0BF',
    emotion: '#8B6A6A',
    time: '#9A7B4F',
    importance: '#4A7C59',
  }

  const runBreath = async () => {
    setBreathLoading(true)
    try {
      let url = `/api/memory/breath-debug?q=${encodeURIComponent(breathQuery)}`
      if (breathValence) url += `&valence=${breathValence}`
      if (breathArousal) url += `&arousal=${breathArousal}`
      const res = await fetch(url)
      setBreathData(await res.json())
    } catch { /* ignore */ }
    setBreathLoading(false)
  }

  return (
    <div>
      {/* Flow pipeline visualization */}
      <div className={`flex items-center gap-1.5 mb-3 p-2.5 rounded-xl ${surfaceBg} overflow-x-auto text-[10px]`}>
        <div className={`px-2 py-1 rounded-lg border ${borderColor} whitespace-nowrap ${breathData ? accent : ''}`}>
          ① 输入
        </div>
        <span className="opacity-30">→</span>
        <div className={`px-2 py-1 rounded-lg border ${borderColor} whitespace-nowrap`}>
          ② 候选 {breathData ? breathData.total_candidates + '桶' : '—'}
        </div>
        <span className="opacity-30">→</span>
        <div className={`px-2 py-1 rounded-lg border ${borderColor} whitespace-nowrap`}>
          ③ 四维评分
        </div>
        <span className="opacity-30">→</span>
        <div className={`px-2 py-1 rounded-lg border ${borderColor} whitespace-nowrap`}>
          ④ 过滤 {breathData ? `≥${breathData.threshold} → ${breathData.passed_count}通过` : '—'}
        </div>
        <span className="opacity-30">→</span>
        <div className={`px-2 py-1 rounded-lg border ${borderColor} whitespace-nowrap`}>⑤ 排序</div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 mb-3">
        <input
          value={breathQuery}
          onChange={e => setBreathQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && runBreath()}
          placeholder="Query..."
          className={`flex-1 min-w-[120px] text-xs px-3 py-2 rounded-xl ${surfaceBg} outline-none border ${borderColor}`}
        />
        <input
          value={breathValence}
          onChange={e => setBreathValence(e.target.value)}
          placeholder="V"
          type="number"
          min="0" max="1" step="0.1"
          className={`w-14 text-xs px-2 py-2 rounded-xl ${surfaceBg} outline-none border ${borderColor}`}
        />
        <input
          value={breathArousal}
          onChange={e => setBreathArousal(e.target.value)}
          placeholder="A"
          type="number"
          min="0" max="1" step="0.1"
          className={`w-14 text-xs px-2 py-2 rounded-xl ${surfaceBg} outline-none border ${borderColor}`}
        />
        <button
          onClick={runBreath}
          className={`text-xs px-4 py-2 rounded-xl ${accentBg} ${accent} font-medium`}
        >
          模拟
        </button>
      </div>

      {/* Results */}
      {breathLoading && <div className={`text-center py-8 text-sm ${mutedText}`}>计算中...</div>}

      {breathData && !breathLoading && (
        <div>
          {/* Weight info */}
          <div className={`text-[10px] ${mutedText} mb-3 p-2 rounded-lg ${surfaceBg}`}>
            权重 topic={breathData.weights?.topic} emotion={breathData.weights?.emotion} time={breathData.weights?.time} imp={breathData.weights?.importance}
            &nbsp;|&nbsp;阈值={breathData.threshold}&nbsp;|&nbsp;候选={breathData.total_candidates} → 通过={breathData.passed_count}
          </div>

          {/* Score rows */}
          <div className="space-y-1">
            {(breathData.results || []).slice(0, 30).map((r: BreathResult, i: number) => {
              const icon = r.pinned ? '📌' : r.type === 'feel' ? '🫧' : r.resolved ? '💤' : '💭'
              return (
                <div key={r.id} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${surfaceBg}`}>
                  <span className={`text-[10px] w-5 text-center ${mutedText}`}>{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-xs">{icon}</span>
                  <span className="text-xs flex-1 min-w-0 truncate">{r.name}</span>

                  {/* Score bars */}
                  <div className="flex gap-0.5 w-32">
                    {Object.entries(r.scores).map(([key, val]) => (
                      <div key={key} className="flex-1">
                        <div className={`h-1 rounded-full ${isNight ? 'bg-night-border' : 'bg-gray-200'} overflow-hidden`}>
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${Math.round(val * 100)}%`, backgroundColor: barColors[key] }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <span className={`text-xs font-medium w-10 text-right ${
                    r.passed_threshold ? 'text-green-600' : mutedText
                  }`}>
                    {r.normalized.toFixed(1)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!breathData && !breathLoading && (
        <div className={`text-center py-8 text-sm ${mutedText}`}>输入 query 后点击「模拟」查看评分链路</div>
      )}
    </div>
  )
}

// ─── Tab 6: Network (记忆网络) ────────────────────────────────
function NetworkTab({ isNight }: { isNight: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [networkLoading, setNetworkLoading] = useState(true)
  const mutedText = isNight ? 'text-night-muted' : 'text-day-muted'
  const accent = isNight ? 'text-night-amber' : 'text-day-pink'
  const surfaceBg = isNight ? 'bg-night-surface' : 'bg-gray-50'
  const borderColor = isNight ? 'border-night-border' : 'border-day-border'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setNetworkLoading(true)
      try {
        const res = await fetch('/api/memory/network')
        const data: NetworkData = await res.json()
        if (cancelled) return
        drawNetwork(data)
      } catch { /* ignore */ }
      setNetworkLoading(false)
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const drawNetwork = (data: NetworkData) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    const W = rect.width, H = rect.height

    const { nodes, edges } = data
    if (!nodes.length) {
      ctx.fillStyle = isNight ? '#8A8070' : '#888'
      ctx.font = '14px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('没有记忆桶', W / 2, H / 2)
      return
    }

    // Initialize positions
    const positions: Record<string, { x: number; y: number }> = {}
    const cx = W / 2, cy = H / 2
    nodes.forEach((n, i) => {
      const angle = (i / nodes.length) * Math.PI * 2
      const r = Math.min(W, H) * 0.35
      positions[n.id] = {
        x: cx + Math.cos(angle) * r + (Math.random() - 0.5) * 50,
        y: cy + Math.sin(angle) * r + (Math.random() - 0.5) * 50,
      }
    })

    // Force simulation
    for (let iter = 0; iter < 60; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = positions[nodes[i].id], b = positions[nodes[j].id]
          if (!a || !b) continue
          const dx = b.x - a.x, dy = b.y - a.y
          const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
          const force = 800 / (dist * dist)
          const fx = (dx / dist) * force, fy = (dy / dist) * force
          a.x -= fx; a.y -= fy; b.x += fx; b.y += fy
        }
      }
      edges.forEach(e => {
        const a = positions[e.source], b = positions[e.target]
        if (!a || !b) return
        const dx = b.x - a.x, dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const force = (dist - 100) * 0.01 * (e.similarity || 0.5)
        const fx = (dx / Math.max(1, dist)) * force
        const fy = (dy / Math.max(1, dist)) * force
        a.x += fx; a.y += fy; b.x -= fx; b.y -= fy
      })
      nodes.forEach(n => {
        const p = positions[n.id]
        if (!p) return
        p.x += (cx - p.x) * 0.01
        p.y += (cy - p.y) * 0.01
      })
    }

    // Draw
    const bgColor = isNight ? '#1A1814' : '#FDFCF0'
    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, W, H)

    // Edges
    edges.forEach(e => {
      const a = positions[e.source], b = positions[e.target]
      if (!a || !b) return
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.strokeStyle = isNight
        ? `rgba(212, 165, 116, ${e.similarity * 0.35})`
        : `rgba(47, 79, 79, ${e.similarity * 0.35})`
      ctx.lineWidth = Math.max(0.5, e.similarity * 2)
      ctx.stroke()
    })

    // Nodes
    const colors: Record<string, string> = {
      dynamic: isNight ? '#D4A574' : '#2F4F4F',
      permanent: '#9A7B4F',
      feel: '#8B6A6A',
      archived: '#B0A590',
    }
    nodes.forEach(n => {
      const p = positions[n.id]
      if (!p) return
      const r = Math.max(4, Math.min(14, n.score * 0.8))
      const color = colors[n.type] || colors.dynamic

      ctx.beginPath()
      ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2)
      ctx.fillStyle = color + '15'
      ctx.fill()

      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fillStyle = n.resolved ? color + '70' : color
      ctx.fill()

      if (n.pinned) {
        ctx.strokeStyle = '#9A7B4F'
        ctx.lineWidth = 2
        ctx.stroke()
      }

      const name = n.name.length > 10 ? n.name.slice(0, 10) + '…' : n.name
      ctx.fillStyle = isNight ? '#C4B89A' : '#3A3530'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(name, p.x, p.y + r + 12)
    })
  }

  return (
    <div>
      {/* Legend */}
      <div className="flex gap-3 mb-2 text-[10px]">
        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: isNight ? '#D4A574' : '#2F4F4F' }} /> dynamic</div>
        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#9A7B4F' }} /> permanent</div>
        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#8B6A6A' }} /> feel</div>
        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: '#B0A590' }} /> archived</div>
      </div>

      {networkLoading && <div className={`text-center py-12 text-sm ${mutedText}`}>加载记忆网络...</div>}

      <canvas
        ref={canvasRef}
        className={`w-full rounded-xl border ${borderColor}`}
        style={{ height: 'calc(100vh - 280px)', display: networkLoading ? 'none' : 'block' }}
      />
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
  const icon = bucket.pinned ? '📌' : bucket.type === 'feel' ? '🫧' : bucket.digested ? '🌿' : bucket.resolved ? '💤' : '💭'

  return (
    <button
      onClick={() => onSelect(bucket)}
      className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors hover:${
        isNight ? 'bg-night-surface/60' : 'bg-gray-50'
      } ${compact ? 'py-1.5' : ''}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] w-5 text-center flex-shrink-0">{icon}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${accentBg} ${accent} flex-shrink-0`}>{relation}</span>
        <span className="text-xs flex-1 min-w-0 truncate">{bucket.name}</span>
        <span className={`text-[10px] flex-shrink-0 ${mutedText}`}>{bucket.score.toFixed(1)}</span>
      </div>
      {showDomain && bucket.domain.length > 0 && (
        <div className="flex gap-1 mt-1 ml-7">
          {bucket.domain.map(d => (
            <span key={d} className={`text-[9px] px-1 py-0.5 rounded ${surfaceBg} ${mutedText}`}>{d}</span>
          ))}
        </div>
      )}
      {bucket.summary && !compact && (
        <p className={`text-[10px] ${mutedText} mt-1 ml-7 line-clamp-2`}>
          {bucket.summary || bucket.content_preview}
        </p>
      )}
    </button>
  )
}
