'use client'

import { shareToChat } from '@/lib/share'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, ChevronDown, ChevronRight, Pin, Check, Trash2, Edit3, Save, RefreshCw, Settings, Zap } from 'lucide-react'
import { apiRequest } from '@/lib/api'

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
  created: string
  last_active: string
  activation_count: number
  model_valence?: number
  summary?: string
  score: number
  content_preview: string
}

// ─── Tab definitions ──────────────────────────────────────────
type TabKey = 'clusters' | 'nodes' | 'lines' | 'evolution' | 'breath' | 'network' | 'admin'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'clusters', label: '团块' },
  { key: 'nodes', label: '端点' },
  { key: 'lines', label: '连线' },
  { key: 'evolution', label: '演变' },
  { key: 'breath', label: '呼吸' },
  { key: 'network', label: '网络' },
  { key: 'admin', label: '⚙' },
]

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'pinned', label: '📌' },
  { key: 'feel', label: '🫧' },
  { key: 'unresolved', label: '⚡' },
  { key: 'digested', label: '🌿' },
]

const RELATION_WORDS = [
  '做了','是','说过','想要','喜欢','拥有','经历了','袒露','害怕',
  '提出','承诺','去过','发现','有','买了','讨厌','承认','告诉',
  '学过','拒绝','画了','梦到','做过','需要',
]

function extractRelation(bucket: Bucket): string {
  for (const tag of bucket.tags) {
    for (const rel of RELATION_WORDS) { if (tag.includes(rel)) return rel }
  }
  if (bucket.type === 'feel') return '感受'
  if (bucket.type === 'permanent') return '记住'
  if (bucket.resolved) return '经历了'
  return '记录'
}

function timeAgo(iso: string): string {
  if (!iso) return '—'
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600000)
  if (h < 1) return '刚刚'
  if (h < 24) return h + 'h前'
  const d = Math.floor(h / 24)
  if (d < 30) return d + 'd前'
  return Math.floor(d / 30) + 'mo前'
}

// ─── Main Component ───────────────────────────────────────────
export function MemoryView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const [activeTab, setActiveTab] = useState<TabKey>('clusters')
  const [buckets, setBuckets] = useState<Bucket[]>(() => {
    if (typeof window === 'undefined') return []
    try { return JSON.parse(sessionStorage.getItem('lumbre-memory-page') || '[]') } catch { return [] }
  })
  const [loading, setLoading] = useState(buckets.length === 0)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [selectedBucket, setSelectedBucket] = useState<Bucket | null>(null)
  const [detailContent, setDetailContent] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [stats, setStats] = useState({ total: 0, pinned: 0, feel: 0, resolved: 0 })
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState<{name:string;importance:number;tags:string;domain:string;content:string}>({name:'',importance:5,tags:'',domain:'',content:''})
  const [batchMode, setBatchMode] = useState(false)
  const [batchSelected, setBatchSelected] = useState<Set<string>>(new Set())

  const fetchBuckets = useCallback(async (append = false) => {
    const cursor = append ? nextCursor : 0
    if (append && cursor == null) return
    if (append || buckets.length) setRefreshing(true); else setLoading(true)
    setLoadError('')
    try {
      const params = new URLSearchParams({ limit: '100', cursor: String(cursor || 0), filter })
      const data = await apiRequest(`/api/memory/buckets?${params.toString()}`)
      const items: Bucket[] = Array.isArray(data?.items) ? data.items : []
      setBuckets(prev => {
        const next = append ? [...prev, ...items.filter(item => !prev.some(old => old.id === item.id))] : items
        if (!append && filter === 'all') {
          try { sessionStorage.setItem('lumbre-memory-page', JSON.stringify(next)) } catch {}
        }
        return next
      })
      setNextCursor(typeof data.nextCursor === 'number' ? data.nextCursor : null)
      if (data.stats) setStats(data.stats)
    } catch (err: any) {
      setLoadError(err?.message || '记忆加载失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [buckets.length, filter, nextCursor])

  useEffect(() => { fetchBuckets(false) }, [filter]) // eslint-disable-line react-hooks/exhaustive-deps

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { fetchBuckets(false); return }
    setLoading(true)
    try {
      const data = await apiRequest(`/api/memory/search?q=${encodeURIComponent(q)}`)
      const hits = [...(data.keyword_hits || []), ...(data.vector_hits || [])]
      const seen = new Set<string>()
      setBuckets(hits.filter((h: Bucket) => { if (seen.has(h.id)) return false; seen.add(h.id); return true }))
    } catch {} finally { setLoading(false) }
  }, [fetchBuckets])

  const openDetail = useCallback(async (b: Bucket) => {
    setSelectedBucket(b)
    setDetailContent(b.content_preview)
    setDetailLoading(true)
    setEditing(false)
    try {
      const res = await fetch(`/api/memory/bucket?id=${b.id}`)
      const data = await res.json()
      if (data.content) {
        setDetailContent(data.content)
        setEditForm({
          name: data.metadata?.name || b.name,
          importance: data.metadata?.importance || b.importance,
          tags: (data.metadata?.tags || b.tags).join(', '),
          domain: (data.metadata?.domain || b.domain).join(', '),
          content: data.content,
        })
      }
    } catch {} finally { setDetailLoading(false) }
  }, [])

  const doAction = useCallback(async (action: string, id: string) => {
    if (action === 'delete' && !confirm('确认归档？')) return
    await fetch(`/api/memory/bucket-${action}?id=${id}`, { method: 'POST' })
    fetchBuckets()
    setSelectedBucket(null)
  }, [fetchBuckets])

  const saveEdit = useCallback(async () => {
    if (!selectedBucket) return
    await fetch(`/api/memory/bucket-edit?id=${selectedBucket.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editForm.name,
        importance: editForm.importance,
        tags: editForm.tags.split(',').map(t => t.trim()).filter(Boolean),
        domain: editForm.domain.split(',').map(d => d.trim()).filter(Boolean),
        content: editForm.content,
      }),
    })
    setEditing(false)
    fetchBuckets()
    setSelectedBucket(null)
  }, [selectedBucket, editForm, fetchBuckets])

  const doBatchPurge = useCallback(async () => {
    if (!batchSelected.size) return
    if (!confirm(`永久删除 ${batchSelected.size} 个桶？不可恢复！`)) return
    await fetch('/api/memory/bucket-purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(batchSelected) }),
    })
    setBatchMode(false)
    setBatchSelected(new Set())
    fetchBuckets()
  }, [batchSelected, fetchBuckets])

  const toggleBatch = (id: string) => {
    setBatchSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  // Client-side filtering
  const filtered = useMemo(() => {
    let list = buckets
    if (filter === 'pinned') list = list.filter(b => b.pinned)
    else if (filter === 'feel') list = list.filter(b => b.type === 'feel')
    else if (filter === 'unresolved') list = list.filter(b => !b.resolved && b.type !== 'permanent' && !b.pinned)
    else if (filter === 'digested') list = list.filter(b => b.digested)

    if (query.trim()) {
      const q = query.toLowerCase()
      list = list.filter(b =>
        b.name.toLowerCase().includes(q) || (b.content_preview || '').toLowerCase().includes(q) ||
        b.tags.some(t => t.toLowerCase().includes(q)) || b.domain.some(d => d.toLowerCase().includes(q))
      )
    }
    return list
  }, [buckets, filter, query])

  const c = {
    accent: isNight ? 'text-night-amber' : 'text-day-pink',
    accentBg: isNight ? 'bg-night-amber/15' : 'bg-day-pinkLight',
    card: isNight ? 'bg-night-card' : 'bg-white',
    surface: isNight ? 'bg-night-surface' : 'bg-gray-50',
    muted: isNight ? 'text-night-muted' : 'text-day-muted',
    border: isNight ? 'border-night-border' : 'border-day-border',
  }

  return (
    <div className="h-full flex flex-col">
      {/* Stats bar */}
      <div className={`px-4 pt-2 pb-1 text-[10px] ${c.muted} flex gap-3 items-center`}>
        <span>{stats.total} 桶</span><span>📌 {stats.pinned}</span>
        <span>🫧 {stats.feel}</span><span>✅ {stats.resolved}</span>
        <div className="flex-1" />
        {['clusters','nodes','lines','evolution'].includes(activeTab) && (
          <button onClick={() => { setBatchMode(!batchMode); setBatchSelected(new Set()) }}
            className={`px-2 py-0.5 rounded text-[10px] ${batchMode ? `${c.accentBg} ${c.accent}` : `${c.surface} ${c.muted}`}`}>
            {batchMode ? `已选 ${batchSelected.size}` : '批量'}
          </button>
        )}
        {batchMode && batchSelected.size > 0 && (
          <button onClick={doBatchPurge} className="px-2 py-0.5 rounded text-[10px] bg-red-500/15 text-red-500">删除</button>
        )}
      </div>

      {/* Tabs */}
      <div className={`px-4 pb-1 flex items-center gap-0.5 border-b ${c.border} overflow-x-auto`}>
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-2.5 py-1.5 text-[11px] rounded-lg transition-all flex-shrink-0 ${
              activeTab === tab.key ? `${c.accentBg} ${c.accent} font-medium` : `${c.muted} hover:opacity-70`
            }`}>{tab.label}</button>
        ))}
      </div>

      {/* Filters + Search (browse tabs only) */}
      {['clusters','nodes','lines','evolution'].includes(activeTab) && (
        <>
          <div className="px-4 py-1.5 flex gap-1 overflow-x-auto">
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ${
                  filter === f.key ? `${c.accentBg} ${c.accent}` : `${c.surface} ${c.muted}`
                }`}>{f.label}</button>
            ))}
          </div>
          <div className="px-4 py-1.5">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl ${c.surface}`}>
              <Search size={14} className="opacity-30" />
              <input value={query} onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && doSearch(query)}
                placeholder="搜索记忆..." className="flex-1 bg-transparent outline-none text-xs placeholder:opacity-30" />
              {query && <button onClick={() => { setQuery(''); fetchBuckets(false) }}><X size={12} className="opacity-40" /></button>}
            </div>
          </div>
        </>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading && buckets.length === 0 && !['breath','network','admin'].includes(activeTab) ? (
          <div className={`text-center py-12 text-sm ${c.muted}`}>加载中...</div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
              {activeTab === 'clusters' && <ClustersTab buckets={filtered} isNight={isNight} onSelect={openDetail} batchMode={batchMode} batchSelected={batchSelected} toggleBatch={toggleBatch} />}
              {activeTab === 'nodes' && <NodesTab buckets={filtered} isNight={isNight} onSelect={openDetail} batchMode={batchMode} batchSelected={batchSelected} toggleBatch={toggleBatch} />}
              {activeTab === 'lines' && <LinesTab buckets={filtered} isNight={isNight} onSelect={openDetail} />}
              {activeTab === 'evolution' && <EvolutionTab buckets={filtered} isNight={isNight} onSelect={openDetail} batchMode={batchMode} batchSelected={batchSelected} toggleBatch={toggleBatch} />}
              {activeTab === 'breath' && <BreathTab isNight={isNight} />}
              {activeTab === 'network' && <NetworkTab isNight={isNight} />}
              {activeTab === 'admin' && <AdminTab isNight={isNight} onRefresh={() => fetchBuckets(false)} />}
              {['clusters','nodes','lines','evolution'].includes(activeTab) && (
                <div className="py-4 flex flex-col items-center gap-2">
                  {loadError && <div className="text-[11px] text-night-error">{loadError} · <button className="underline" onClick={() => fetchBuckets(false)}>重试</button></div>}
                  {nextCursor != null && !query && (
                    <button disabled={refreshing} onClick={() => fetchBuckets(true)} className={`text-[11px] px-4 py-2 rounded-full ${c.surface} ${c.muted} disabled:opacity-40`}>
                      {refreshing ? '正在加载…' : `加载更多（已显示 ${buckets.length}/${stats.total}）`}
                    </button>
                  )}
                  {refreshing && buckets.length > 0 && nextCursor == null && <span className={`text-[10px] ${c.muted}`}>正在刷新…</span>}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Detail Panel */}
      <AnimatePresence>
        {selectedBucket && (
          <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25 }}
            className={`absolute bottom-0 left-0 right-0 rounded-t-2xl p-5 max-h-[70%] overflow-y-auto z-30 ${c.card} ${isNight ? '' : 'shadow-lg'}`}>
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1 min-w-0">
                {editing ? (
                  <input value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})}
                    className={`w-full text-sm font-medium px-2 py-1 rounded-lg ${c.surface} outline-none border ${c.border}`} />
                ) : (
                  <h3 className="font-medium text-sm truncate">{selectedBucket.name}</h3>
                )}
                {!editing && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {selectedBucket.domain.map(d => <span key={d} className={`text-[10px] px-1.5 py-0.5 rounded ${c.accentBg} ${c.accent}`}>{d}</span>)}
                    {selectedBucket.tags.slice(0, 6).map(t => <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded ${c.surface} ${c.muted}`}>{t}</span>)}
                  </div>
                )}
              </div>
              <div className="flex gap-1 ml-2">
                <button onClick={() => setEditing(!editing)} className={`p-1 rounded ${editing ? c.accentBg : ''}`}>
                  <Edit3 size={14} className={editing ? '' : 'opacity-40'} />
                </button>
                <button onClick={() => shareToChat({kind:'memory', title:'🧠 '+selectedBucket.name, subtitle:selectedBucket.domain?.join?.('、') || '', body:selectedBucket.content_preview || '', metadata:{...selectedBucket}})} className="p-1" title="分享到 Chat">↗</button>
                <button onClick={() => setSelectedBucket(null)} className="p-1"><X size={16} className="opacity-40" /></button>
              </div>
            </div>

            {editing ? (
              <div className="space-y-2">
                <div>
                  <label className={`text-[10px] ${c.muted}`}>标签（逗号分隔）</label>
                  <input value={editForm.tags} onChange={e => setEditForm({...editForm, tags: e.target.value})}
                    className={`w-full text-xs px-2 py-1.5 rounded-lg ${c.surface} outline-none border ${c.border}`} />
                </div>
                <div>
                  <label className={`text-[10px] ${c.muted}`}>领域（逗号分隔）</label>
                  <input value={editForm.domain} onChange={e => setEditForm({...editForm, domain: e.target.value})}
                    className={`w-full text-xs px-2 py-1.5 rounded-lg ${c.surface} outline-none border ${c.border}`} />
                </div>
                <div>
                  <label className={`text-[10px] ${c.muted}`}>重要性 ({editForm.importance})</label>
                  <input type="range" min={1} max={10} value={editForm.importance}
                    onChange={e => setEditForm({...editForm, importance: parseInt(e.target.value)})}
                    className="w-full h-1 rounded-full appearance-none cursor-pointer" />
                </div>
                <div>
                  <label className={`text-[10px] ${c.muted}`}>内容</label>
                  <textarea value={editForm.content} onChange={e => setEditForm({...editForm, content: e.target.value})}
                    rows={6} className={`w-full text-xs px-2 py-1.5 rounded-lg ${c.surface} outline-none border ${c.border} resize-none`} />
                </div>
                <div className="flex gap-2">
                  <button onClick={saveEdit} className={`text-[11px] px-4 py-1.5 rounded-lg ${c.accentBg} ${c.accent} font-medium flex items-center gap-1`}>
                    <Save size={12} /> 保存
                  </button>
                  <button onClick={() => setEditing(false)} className={`text-[11px] px-4 py-1.5 rounded-lg ${c.surface} ${c.muted}`}>取消</button>
                </div>
              </div>
            ) : (
              <>
                <div className={`text-xs leading-relaxed opacity-80 whitespace-pre-wrap rounded-xl p-3 ${c.surface} max-h-[40vh] overflow-y-auto`}>
                  {detailLoading ? '加载中...' : detailContent}
                </div>

                <div className={`grid grid-cols-3 gap-2 mt-3 text-[10px] ${c.muted}`}>
                  <div><div className="opacity-50">ID</div><div className="font-mono truncate">{selectedBucket.id}</div></div>
                  <div><div className="opacity-50">类型</div><div>{selectedBucket.type}</div></div>
                  <div><div className="opacity-50">重要性</div><div>{selectedBucket.importance}/10</div></div>
                  <div><div className="opacity-50">效价 V</div><div>{selectedBucket.valence?.toFixed(2)}</div></div>
                  <div><div className="opacity-50">唤醒 A</div><div>{selectedBucket.arousal?.toFixed(2)}</div></div>
                  <div><div className="opacity-50">权重</div><div>{selectedBucket.score?.toFixed(2)}</div></div>
                  <div><div className="opacity-50">激活</div><div>{selectedBucket.activation_count}</div></div>
                  <div><div className="opacity-50">创建</div><div>{timeAgo(selectedBucket.created)}</div></div>
                  <div><div className="opacity-50">活跃</div><div>{timeAgo(selectedBucket.last_active)}</div></div>
                </div>

                <div className="flex gap-2 mt-2 text-[10px]">
                  {selectedBucket.pinned && <span className={`px-1.5 py-0.5 rounded ${c.accentBg}`}>📌 钉选</span>}
                  {selectedBucket.resolved && <span className={`px-1.5 py-0.5 rounded ${c.surface}`}>✅ 已解决</span>}
                  {selectedBucket.digested && <span className={`px-1.5 py-0.5 rounded ${c.surface}`}>🌿 已消化</span>}
                </div>

                <div className="flex gap-2 mt-3 pt-3 border-t border-current/10">
                  <button onClick={() => doAction('pin', selectedBucket.id)} className={`text-[11px] px-3 py-1.5 rounded-lg ${c.surface} flex items-center gap-1`}>
                    <Pin size={12} /> {selectedBucket.pinned ? '取消钉选' : '钉选'}
                  </button>
                  <button onClick={() => doAction('resolve', selectedBucket.id)} className={`text-[11px] px-3 py-1.5 rounded-lg ${c.surface} flex items-center gap-1`}>
                    <Check size={12} /> {selectedBucket.resolved ? '标未解决' : '标已解决'}
                  </button>
                  <button onClick={() => doAction('delete', selectedBucket.id)} className={`text-[11px] px-3 py-1.5 rounded-lg ${c.surface} flex items-center gap-1 opacity-50`}>
                    <Trash2 size={12} /> 归档
                  </button>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Clusters ─────────────────────────────────────────────────
function ClustersTab({ buckets, isNight, onSelect, batchMode, batchSelected, toggleBatch }: {
  buckets: Bucket[]; isNight: boolean; onSelect: (b: Bucket) => void
  batchMode: boolean; batchSelected: Set<string>; toggleBatch: (id: string) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const c = useColors(isNight)

  const clusters = useMemo(() => {
    const map = new Map<string, Bucket[]>()
    for (const b of buckets) {
      for (const d of (b.domain?.length ? b.domain : ['未分类'])) {
        if (!map.has(d)) map.set(d, [])
        map.get(d)!.push(b)
      }
    }
    return Array.from(map.entries())
      .map(([domain, items]) => ({ domain, items: items.sort((a: Bucket, b: Bucket) => b.score - a.score), tags: Array.from(new Set(items.flatMap(i => i.tags))).slice(0, 8) }))
      .sort((a, b) => b.items.length - a.items.length)
  }, [buckets])

  if (!clusters.length) return <Empty c={c} />

  return (
    <div className="space-y-2">
      {clusters.map(cl => {
        const open = expanded === cl.domain
        return (
          <div key={cl.domain} className={`rounded-xl overflow-hidden border ${c.border}`}>
            <button onClick={() => setExpanded(open ? null : cl.domain)}
              className={`w-full px-3 py-2.5 flex items-center gap-2 text-left ${open ? c.accentBg : c.surface}`}>
              {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${open ? c.accent : ''}`}>{cl.domain}</span>
                  <span className={`text-[10px] ${c.muted}`}>{cl.items.length} 条</span>
                </div>
                {!open && <div className="flex flex-wrap gap-1 mt-1">
                  {cl.tags.slice(0, 5).map(t => <span key={t} className={`text-[9px] px-1 py-0.5 rounded ${c.surface} ${c.muted}`}>{t}</span>)}
                </div>}
              </div>
            </button>
            <AnimatePresence>
              {open && <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                <div className={`px-3 py-2 space-y-1 ${c.card}`}>
                  <div className="flex flex-wrap gap-1 mb-2">
                    {cl.tags.map(t => <span key={t} className={`text-[10px] px-1.5 py-0.5 rounded-full ${c.surface} ${c.muted}`}>{t}</span>)}
                  </div>
                  {cl.items.map(item => <BucketRow key={item.id} bucket={item} isNight={isNight} onSelect={onSelect}
                    batchMode={batchMode} selected={batchSelected.has(item.id)} toggleBatch={toggleBatch} />)}
                </div>
              </motion.div>}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

// ─── Nodes ────────────────────────────────────────────────────
function NodesTab({ buckets, isNight, onSelect, batchMode, batchSelected, toggleBatch }: {
  buckets: Bucket[]; isNight: boolean; onSelect: (b: Bucket) => void
  batchMode: boolean; batchSelected: Set<string>; toggleBatch: (id: string) => void
}) {
  const c = useColors(isNight)
  if (!buckets.length) return <Empty c={c} />
  return <div className="space-y-1">{buckets.map(b => <BucketRow key={b.id} bucket={b} isNight={isNight} onSelect={onSelect} showDomain
    batchMode={batchMode} selected={batchSelected.has(b.id)} toggleBatch={toggleBatch} />)}</div>
}

// ─── Lines ────────────────────────────────────────────────────
function LinesTab({ buckets, isNight, onSelect }: { buckets: Bucket[]; isNight: boolean; onSelect: (b: Bucket) => void }) {
  const [sel, setSel] = useState<string | null>(null)
  const c = useColors(isNight)

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of buckets) for (const t of b.tags) m.set(t, (m.get(t) || 0) + 1)
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [buckets])

  const hit = useMemo(() => sel ? buckets.filter(b => b.tags.includes(sel)) : [], [buckets, sel])

  if (!buckets.length) return <Empty c={c} />
  return (
    <div>
      <p className={`text-[10px] ${c.muted} mb-2`}>线的名字 · 点了过滤</p>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {tagCounts.map(([tag, n]) => (
          <button key={tag} onClick={() => setSel(sel === tag ? null : tag)}
            className={`text-[11px] px-2 py-1 rounded-full transition-all ${sel === tag ? `${c.accentBg} ${c.accent}` : `${c.surface} ${c.muted}`}`}>
            {tag} <span className="opacity-50">{n}</span>
          </button>
        ))}
      </div>
      {sel && (
        <div className={`rounded-xl border ${c.border} overflow-hidden`}>
          <div className={`px-3 py-2 ${c.accentBg} flex items-center justify-between`}>
            <span className={`text-xs ${c.accent}`}>关系：{sel}</span>
            <button onClick={() => setSel(null)}><X size={12} className="opacity-40" /></button>
          </div>
          <div className={`px-3 py-2 space-y-1 ${c.card}`}>
            {hit.map(b => <BucketRow key={b.id} bucket={b} isNight={isNight} onSelect={onSelect} relationTag={sel} />)}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Evolution ────────────────────────────────────────────────
function EvolutionTab({ buckets, isNight, onSelect, batchMode, batchSelected, toggleBatch }: {
  buckets: Bucket[]; isNight: boolean; onSelect: (b: Bucket) => void
  batchMode: boolean; batchSelected: Set<string>; toggleBatch: (id: string) => void
}) {
  const c = useColors(isNight)
  const timeline = useMemo(() => {
    const sorted = [...buckets].sort((a, b) => (b.created || '').localeCompare(a.created || ''))
    const groups = new Map<string, Bucket[]>()
    for (const b of sorted) {
      const date = (b.created || '').slice(0, 10) || '未知'
      if (!groups.has(date)) groups.set(date, [])
      groups.get(date)!.push(b)
    }
    return Array.from(groups.entries())
  }, [buckets])

  if (!buckets.length) return <Empty c={c} />
  return (
    <div className="relative">
      <div className={`absolute left-[7px] top-0 bottom-0 w-px ${isNight ? 'bg-night-border' : 'bg-day-border'}`} />
      <div className="space-y-4">
        {timeline.map(([date, items]) => (
          <div key={date} className="relative pl-6">
            <div className={`absolute left-0 top-1 w-[15px] h-[15px] rounded-full border-2 ${isNight ? 'border-night-amber bg-night-bg' : 'border-day-pink bg-day-bg'}`} />
            <div className={`text-[10px] ${c.accent} font-medium mb-1.5`}>{date}</div>
            <div className="space-y-1">{items.map(b => <BucketRow key={b.id} bucket={b} isNight={isNight} onSelect={onSelect} showDomain compact
              batchMode={batchMode} selected={batchSelected.has(b.id)} toggleBatch={toggleBatch} />)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Breath ───────────────────────────────────────────────────
function BreathTab({ isNight }: { isNight: boolean }) {
  const [q, setQ] = useState('')
  const [v, setV] = useState('')
  const [a, setA] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<any[] | null>(null)
  const c = useColors(isNight)

  const barColors: Record<string, string> = {
    topic: isNight ? '#D4A574' : '#E8A0BF',
    emotion: '#8B6A6A',
    time: '#9A7B4F',
    importance: '#4A7C59',
  }

  const run = async () => {
    setLoading(true)
    try {
      let url = `/api/memory/breath-debug?q=${encodeURIComponent(q)}`
      if (v) url += `&valence=${v}`
      if (a) url += `&arousal=${a}`
      const res = await fetch(url)
      setResults(await res.json())
    } catch {} finally { setLoading(false) }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && run()}
          placeholder="Query..." className={`flex-1 min-w-[120px] text-xs px-3 py-2 rounded-xl ${c.surface} outline-none border ${c.border}`} />
        <input value={v} onChange={e => setV(e.target.value)} placeholder="V" type="number" min="0" max="1" step="0.1"
          className={`w-14 text-xs px-2 py-2 rounded-xl ${c.surface} outline-none border ${c.border}`} />
        <input value={a} onChange={e => setA(e.target.value)} placeholder="A" type="number" min="0" max="1" step="0.1"
          className={`w-14 text-xs px-2 py-2 rounded-xl ${c.surface} outline-none border ${c.border}`} />
        <button onClick={run} className={`text-xs px-4 py-2 rounded-xl ${c.accentBg} ${c.accent} font-medium`}>模拟</button>
      </div>

      <div className={`flex gap-3 mb-2 text-[9px] ${c.muted}`}>
        {Object.entries(barColors).map(([k, color]) => (
          <span key={k} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full" style={{ background: color }} />
            {k === 'topic' ? '主题' : k === 'emotion' ? '情绪' : k === 'time' ? '时间' : '重要'}
          </span>
        ))}
      </div>

      {loading && <div className={`text-center py-8 text-sm ${c.muted}`}>计算中...</div>}

      {results && !loading && (
        <div className="space-y-1">
          {results.slice(0, 40).map((r: any, i: number) => (
            <div key={r.id || i} className={`flex items-center gap-2 px-2 py-1.5 rounded-lg ${c.surface}`}>
              <span className={`text-[10px] w-5 text-center ${c.muted}`}>{String(i + 1).padStart(2, '0')}</span>
              <span className="text-xs flex-1 min-w-0 truncate">{r.name}</span>
              <div className="flex gap-0.5 w-28">
                {['topic','emotion','time','importance'].map(key => (
                  <div key={key} className="flex-1">
                    <div className={`h-1 rounded-full ${isNight ? 'bg-night-border' : 'bg-gray-200'} overflow-hidden`}>
                      <div className="h-full rounded-full" style={{ width: `${Math.round((r.scores?.[key] || 0) * 100)}%`, backgroundColor: barColors[key] }} />
                    </div>
                  </div>
                ))}
              </div>
              <span className={`text-xs font-medium w-10 text-right ${r.passed ? 'text-green-600' : c.muted}`}>
                {(r.scores?.total || r.total || 0).toFixed(2)}
              </span>
            </div>
          ))}
        </div>
      )}

      {!results && !loading && <div className={`text-center py-8 text-sm ${c.muted}`}>输入 query 后点击「模拟」</div>}
    </div>
  )
}

// ─── Network ──────────────────────────────────────────────────
function NetworkTab({ isNight }: { isNight: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(true)
  const c = useColors(isNight)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/memory/network')
        const data = await res.json()
        if (!cancelled) draw(data)
      } catch {}
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const draw = (data: { nodes: any[]; edges: any[] }) => {
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
      ctx.font = '14px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText('没有记忆桶', W / 2, H / 2)
      return
    }

    const pos: Record<string, { x: number; y: number }> = {}
    const cx = W / 2, cy = H / 2
    nodes.forEach((n: any, i: number) => {
      const angle = (i / nodes.length) * Math.PI * 2
      const r = Math.min(W, H) * 0.35
      pos[n.id] = { x: cx + Math.cos(angle) * r + (Math.random() - 0.5) * 50, y: cy + Math.sin(angle) * r + (Math.random() - 0.5) * 50 }
    })

    // Force sim
    for (let iter = 0; iter < 60; iter++) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = pos[nodes[i].id], b = pos[nodes[j].id]
          if (!a || !b) continue
          const dx = b.x - a.x, dy = b.y - a.y
          const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
          const f = 800 / (dist * dist)
          a.x -= (dx / dist) * f; a.y -= (dy / dist) * f
          b.x += (dx / dist) * f; b.y += (dy / dist) * f
        }
      }
      edges.forEach((e: any) => {
        const a = pos[e.source], b = pos[e.target]
        if (!a || !b) return
        const dx = b.x - a.x, dy = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        const f = (dist - 100) * 0.01 * (e.weight || e.similarity || 0.5)
        a.x += (dx / Math.max(1, dist)) * f; a.y += (dy / Math.max(1, dist)) * f
        b.x -= (dx / Math.max(1, dist)) * f; b.y -= (dy / Math.max(1, dist)) * f
      })
      nodes.forEach((n: any) => {
        const p = pos[n.id]; if (!p) return
        p.x += (cx - p.x) * 0.01; p.y += (cy - p.y) * 0.01
      })
    }

    ctx.fillStyle = isNight ? '#1A1814' : '#FDFCF0'
    ctx.fillRect(0, 0, W, H)

    edges.forEach((e: any) => {
      const a = pos[e.source], b = pos[e.target]
      if (!a || !b) return
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
      ctx.strokeStyle = isNight ? `rgba(212,165,116,${(e.weight || 0.5) * 0.35})` : `rgba(47,79,79,${(e.weight || 0.5) * 0.35})`
      ctx.lineWidth = Math.max(0.5, (e.weight || 0.5) * 2); ctx.stroke()
    })

    const nodeColor = isNight ? '#D4A574' : '#2F4F4F'
    nodes.forEach((n: any) => {
      const p = pos[n.id]; if (!p) return
      const r = Math.max(4, Math.min(14, (n.importance || 5) * 1.4))
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2)
      ctx.fillStyle = nodeColor + '15'; ctx.fill()
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fillStyle = nodeColor; ctx.fill()

      const name = (n.name || '').length > 10 ? n.name.slice(0, 10) + '…' : n.name
      ctx.fillStyle = isNight ? '#C4B89A' : '#3A3530'
      ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(name, p.x, p.y + r + 12)
    })
  }

  return (
    <div>
      <div className="flex gap-3 mb-2 text-[10px]">
        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: isNight ? '#D4A574' : '#2F4F4F' }} /> 节点</div>
        <div className="flex items-center gap-1"><span className="w-6 h-px" style={{ background: isNight ? '#D4A574' : '#2F4F4F' }} /> 共享标签</div>
      </div>
      {loading && <div className={`text-center py-12 text-sm ${c.muted}`}>加载记忆网络...</div>}
      <canvas ref={canvasRef} className={`w-full rounded-xl border ${c.border}`}
        style={{ height: 'calc(100vh - 280px)', display: loading ? 'none' : 'block' }} />
    </div>
  )
}

// ─── Admin ────────────────────────────────────────────────────
function AdminTab({ isNight, onRefresh }: { isNight: boolean; onRefresh: () => void }) {
  const [status, setStatus] = useState<any>(null)
  const [pulseData, setPulseData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const c = useColors(isNight)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const [sRes, pRes] = await Promise.all([
          fetch('/api/memory/status'),
          fetch('/api/memory/pulse'),
        ])
        setStatus(await sRes.json())
        setPulseData(await pRes.json())
      } catch {} finally { setLoading(false) }
    })()
  }, [])

  if (loading) return <div className={`text-center py-12 text-sm ${c.muted}`}>加载中...</div>

  return (
    <div className="space-y-4">
      {/* System Status */}
      {status && (
        <div className={`rounded-xl border ${c.border} p-3`}>
          <div className="flex items-center gap-2 mb-2">
            <Settings size={14} className={c.accent} />
            <span className={`text-xs font-medium ${c.accent}`}>系统状态</span>
          </div>
          <div className={`grid grid-cols-2 gap-2 text-[11px] ${c.muted}`}>
            <div>版本: <span className="opacity-70">{status.version}</span></div>
            <div>桶数: <span className="opacity-70">{status.bucket_count}</span></div>
            <div>数据量: <span className="opacity-70">{status.data_size_mb} MB</span></div>
            <div>引擎: <span className="opacity-70">{status.decay_engine}</span></div>
            <div>向量搜索: <span className="opacity-70">{status.vector_search ? '✅' : '❌'}</span></div>
            <div>持久化: <span className="opacity-70">{status.persistent ? '✅' : '❌'}</span></div>
          </div>
        </div>
      )}

      {/* Domain distribution */}
      {pulseData?.domains && (
        <div className={`rounded-xl border ${c.border} p-3`}>
          <div className="flex items-center gap-2 mb-2">
            <Zap size={14} className={c.accent} />
            <span className={`text-xs font-medium ${c.accent}`}>领域分布</span>
          </div>
          <div className="space-y-1.5">
            {Object.entries(pulseData.domains as Record<string, number>)
              .sort(([, a], [, b]) => (b as number) - (a as number))
              .slice(0, 15)
              .map(([domain, count]) => {
                const pct = Math.round(((count as number) / (pulseData.total || 1)) * 100)
                return (
                  <div key={domain} className="flex items-center gap-2">
                    <span className={`text-[11px] w-20 truncate ${c.muted}`}>{domain}</span>
                    <div className={`flex-1 h-1.5 rounded-full ${isNight ? 'bg-night-border' : 'bg-gray-200'} overflow-hidden`}>
                      <div className="h-full rounded-full transition-all" style={{
                        width: `${pct}%`,
                        background: isNight ? '#D4A574' : '#E8A0BF',
                      }} />
                    </div>
                    <span className={`text-[10px] w-8 text-right ${c.muted}`}>{count as number}</span>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {/* Type distribution */}
      {pulseData?.types && (
        <div className={`rounded-xl border ${c.border} p-3`}>
          <div className={`text-xs font-medium ${c.accent} mb-2`}>类型分布</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(pulseData.types as Record<string, number>).map(([type, count]) => (
              <span key={type} className={`text-[11px] px-2 py-1 rounded-lg ${c.surface} ${c.muted}`}>
                {type === 'feel' ? '🫧' : type === 'permanent' ? '📌' : type === 'normal' ? '💭' : '📦'} {type}: {count as number}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Quick stats */}
      {pulseData && (
        <div className={`rounded-xl border ${c.border} p-3`}>
          <div className={`text-xs font-medium ${c.accent} mb-2`}>快速统计</div>
          <div className={`grid grid-cols-2 gap-2 text-[11px] ${c.muted}`}>
            <div>总桶数: {pulseData.total}</div>
            <div>📌 钉选: {pulseData.pinned}</div>
            <div>✅ 已解决: {pulseData.resolved}</div>
            <div>⚡ 未解决: {pulseData.unresolved}</div>
            <div>🫧 感受: {pulseData.feel}</div>
            <div>🌐 领域数: {Object.keys(pulseData.domains || {}).length}</div>
          </div>
        </div>
      )}

      <button onClick={onRefresh}
        className={`w-full text-[11px] px-4 py-2.5 rounded-xl ${c.surface} ${c.muted} flex items-center justify-center gap-2`}>
        <RefreshCw size={12} /> 刷新数据
      </button>
    </div>
  )
}

// ─── Shared ───────────────────────────────────────────────────
function useColors(isNight: boolean) {
  return {
    accent: isNight ? 'text-night-amber' : 'text-day-pink',
    accentBg: isNight ? 'bg-night-amber/15' : 'bg-day-pinkLight',
    card: isNight ? 'bg-night-card' : 'bg-white',
    surface: isNight ? 'bg-night-surface' : 'bg-gray-50',
    muted: isNight ? 'text-night-muted' : 'text-day-muted',
    border: isNight ? 'border-night-border' : 'border-day-border',
  }
}

function Empty({ c }: { c: ReturnType<typeof useColors> }) {
  return <div className={`text-center py-12 text-sm ${c.muted}`}>暂无记忆</div>
}

function BucketRow({ bucket, isNight, onSelect, showDomain, compact, relationTag, batchMode, selected, toggleBatch }: {
  bucket: Bucket; isNight: boolean; onSelect: (b: Bucket) => void
  showDomain?: boolean; compact?: boolean; relationTag?: string
  batchMode?: boolean; selected?: boolean; toggleBatch?: (id: string) => void
}) {
  const c = useColors(isNight)
  const relation = relationTag || extractRelation(bucket)
  const icon = bucket.pinned ? '📌' : bucket.type === 'feel' ? '🫧' : bucket.digested ? '🌿' : bucket.resolved ? '💤' : '💭'

  const shareBucket = () => shareToChat({kind:'memory', title:'🧠 '+bucket.name, subtitle:bucket.domain?.join?.('、') || '', body:bucket.content_preview || '', metadata:{...bucket}})
  return (
    <button onClick={() => batchMode && toggleBatch ? toggleBatch(bucket.id) : onSelect(bucket)}
      className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors hover:${isNight ? 'bg-night-surface/60' : 'bg-gray-50'} ${compact ? 'py-1.5' : ''} ${selected ? (isNight ? 'bg-night-amber/10 ring-1 ring-night-amber/30' : 'bg-day-pinkLight ring-1 ring-day-pink/30') : ''}`}>
      <div className="flex items-center gap-2">
        {batchMode && (
          <span className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center text-[10px] ${
            selected ? `${isNight ? 'bg-night-amber border-night-amber' : 'bg-day-pink border-day-pink'} text-white` : c.border
          }`}>{selected ? '✓' : ''}</span>
        )}
        <span className="text-[11px] w-5 text-center flex-shrink-0">{icon}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.accentBg} ${c.accent} flex-shrink-0`}>{relation}</span>
        <span className="text-xs flex-1 min-w-0 truncate">{bucket.name}</span>
        <span className={`text-[10px] flex-shrink-0 ${c.muted}`}>{bucket.score?.toFixed(1)}</span>
        <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); shareBucket() }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); shareBucket() } }} className={`text-[10px] opacity-50 hover:opacity-100 cursor-pointer ${c.muted}`} title="分享到 Chat">↗</span>
      </div>
      {showDomain && bucket.domain?.length > 0 && (
        <div className={`flex gap-1 mt-1 ${batchMode ? 'ml-11' : 'ml-7'}`}>{bucket.domain.map(d => <span key={d} className={`text-[9px] px-1 py-0.5 rounded ${c.surface} ${c.muted}`}>{d}</span>)}</div>
      )}
      {bucket.summary && !compact && <p className={`text-[10px] ${c.muted} mt-1 ${batchMode ? 'ml-11' : 'ml-7'} line-clamp-2`}>{bucket.summary || bucket.content_preview}</p>}
    </button>
  )
}
