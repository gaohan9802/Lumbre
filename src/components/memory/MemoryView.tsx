'use client'

import { shareToChat } from '@/lib/share'
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, X, ChevronDown, ChevronRight, Pin, Check, Trash2, Edit3, Save, RefreshCw, Settings, Zap, Heart } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { useApp } from '@/lib/store'
import { PaperActionDialog } from '@/components/PaperActionDialog'

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

interface StarCandidate {
  id: string
  type: string
  summary: string
  details?: string
  whyImportant?: string
  status: 'pending_star' | 'pending_fire' | 'observing' | 'approved' | 'rejected' | 'journaled'
  owner: 'fire' | 'star'
  importance?: number
  occurredAt?: string
  validTo?: string
  lockOwner?: 'fire' | 'star'
  createdAt: string
  suggestedFamilyIds: string[]
  sources: Array<{ kind: string; actor: string; sessionId?: string; label?: string; excerpt?: string }>
}

interface OmbreImportStatus { total: number; imported: number; remaining: number; feelings: number }

interface StarFamily {
  id: string
  name: string
  title?: string
  summary?: string
  status: 'active' | 'paused' | 'ended' | 'archived'
  parentId?: string
  lockOwner?: 'fire' | 'star'
  memberCount: number
  updatedAt?: string
}

type StarFamilyRole = 'key_event' | 'key_fact' | 'member' | 'unresolved'

interface StarFamilyDetail {
  memberships: Array<{ familyId: string; memoryId: string; role: StarFamilyRole; reason?: string }>
  memories: StarMemory[]
}

interface RecycledStarFamily {
  id: string
  familyId: string
  name: string
  deletedBy: 'fire' | 'star'
  deletedAt: string
  purgeAfter: string
}

interface RecycledStarMemory {
  id: string
  memoryId: string
  summary: string
  deletedBy: 'fire' | 'star'
  deletedAt: string
  purgeAfter: string
}

interface StarMemory {
  id: string
  type: string
  summary: string
  details?: string
  whyImportant?: string
  currentUnderstanding?: string
  occurredAt?: string
  validFrom?: string
  validTo?: string
  importance?: number
  approvedBy: 'fire' | 'star'
  lockOwner?: 'fire' | 'star'
  familyIds: string[]
  createdAt: string
}

interface StarWorkingMemory {
  id: string
  type: string
  summary: string
  importance?: number
  retentionDays: 1 | 7 | 14
  expiresAt: string
  status: 'active' | 'due' | 'dismissed' | 'promoted'
  suggestedFamilyIds: string[]
  createdAt: string
}

interface ResolvedStarSource {
  source: { kind: string; label?: string }
  resolved: Array<{ id?: string; role?: string; content?: string }>
  missing?: boolean
}

interface StarMemoryConflict {
  id: string
  memoryId: string
  currentSummary: string
  proposedSummary: string
  reason?: string
  createdBy: 'fire' | 'star'
  createdAt: string
}

type StarSection = 'timeline' | 'inbox' | 'families' | 'search' | 'current' | 'memories' | 'conflicts' | 'system'
type StarActionDialog =
  | { kind: 'import_ombre' }
  | { kind: 'flag_conflict'; memory: StarMemory; proposedSummary: string; reason: string }
  | { kind: 'merge_family'; family: StarFamily; targetId: string }
  | { kind: 'split_family'; family: StarFamily; name: string }
  | { kind: 'manage_family'; family: StarFamily; action: 'update_family' | 'end_family' | 'recycle_family'; summary: string }

const STAR_SECTIONS: Array<{ key: StarSection; label: string }> = [
  { key: 'timeline', label: '时间线' },
  { key: 'inbox', label: '待审核' },
  { key: 'families', label: '家族' },
  { key: 'search', label: '搜索' },
  { key: 'current', label: '当前' },
  { key: 'memories', label: '记忆' },
  { key: 'conflicts', label: '纠错' },
  { key: 'system', label: '系统' },
]

// ─── Tab definitions ──────────────────────────────────────────
type TabKey = 'clusters' | 'nodes' | 'lines' | 'evolution' | 'star' | 'breath' | 'network' | 'admin'
const TABS: { key: TabKey; label: string }[] = [
  { key: 'clusters', label: '团块' },
  { key: 'nodes', label: '端点' },
  { key: 'lines', label: '连线' },
  { key: 'evolution', label: '演变' },
  { key: 'star', label: '新库' },
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
  const [confirmAction, setConfirmAction] = useState<{kind:'archive';id:string}|{kind:'purge';ids:string[]}|null>(null)

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
    if (action === 'delete') { setConfirmAction({kind:'archive',id}); return }
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
    setConfirmAction({kind:'purge',ids:Array.from(batchSelected)})
  }, [batchSelected])

  const confirmDestructive = async () => {
    if (!confirmAction) return
    if (confirmAction.kind === 'archive') {
      await fetch(`/api/memory/bucket-delete?id=${confirmAction.id}`, { method: 'POST' })
      setSelectedBucket(null)
    } else {
      await fetch('/api/memory/bucket-purge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: confirmAction.ids }) })
      setBatchMode(false); setBatchSelected(new Set())
    }
    setConfirmAction(null)
    fetchBuckets()
  }

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
    accent: isNight ? 'text-night-amber' : 'text-[#9c6e69]',
    accentBg: isNight ? 'bg-night-amber/15' : 'bg-[#DBB9B3]/20',
    card: isNight ? 'bg-night-card' : 'chat-dialog-card',
    surface: isNight ? 'bg-night-surface' : 'bg-[#DBB9B3]/10',
    muted: isNight ? 'text-night-muted' : 'text-day-muted',
    border: isNight ? 'border-night-border' : 'border-[#a73a32]/15',
  }
  const tabGroup = activeTab === 'admin' ? 'admin' : ['breath', 'network'].includes(activeTab) ? 'observe' : 'memory'
  const visibleTabs = tabGroup === 'observe'
    ? TABS.filter(tab => ['breath', 'network'].includes(tab.key))
    : TABS.filter(tab => ['clusters', 'nodes', 'lines', 'evolution', 'star'].includes(tab.key))

  return (
    <div className={`relative h-full flex flex-col ${isNight ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
      {/* Stats bar */}
      {activeTab !== 'star' && <div className={`px-4 pt-2 pb-1 text-[10px] ${c.muted} flex gap-3 items-center`}>
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
      </div>}

      {/* Tab groups */}
      <div className={`mx-4 mb-1 grid grid-cols-3 gap-1 rounded-xl p-1 ${c.surface}`}>
        <button onClick={() => setActiveTab('clusters')} className={`rounded-lg px-3 py-1.5 text-[11px] ${tabGroup === 'memory' ? `${c.accentBg} ${c.accent} font-medium` : c.muted}`}>记忆</button>
        <button onClick={() => setActiveTab('breath')} className={`rounded-lg px-3 py-1.5 text-[11px] ${tabGroup === 'observe' ? `${c.accentBg} ${c.accent} font-medium` : c.muted}`}>观察</button>
        <button aria-label="记忆管理" onClick={() => setActiveTab('admin')} className={`grid place-items-center rounded-lg px-3 py-1.5 ${tabGroup === 'admin' ? `${c.accentBg} ${c.accent}` : c.muted}`}><Settings size={13}/></button>
      </div>
      {tabGroup !== 'admin' && <div className={`px-4 pb-1 flex items-center gap-0.5 border-b ${c.border} overflow-x-auto`}>
        {visibleTabs.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)}
            className={`px-2.5 py-1.5 text-[11px] rounded-lg transition-all flex-shrink-0 ${
              activeTab === tab.key ? `${c.accentBg} ${c.accent} font-medium` : `${c.muted} hover:opacity-70`
            }`}>{tab.label}</button>
        ))}
      </div>}

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
        {loading && buckets.length === 0 && !['star','breath','network','admin'].includes(activeTab) ? (
          <div className={`text-center py-12 text-sm ${c.muted}`}>加载中...</div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}>
              {activeTab === 'clusters' && <ClustersTab buckets={filtered} isNight={isNight} onSelect={openDetail} batchMode={batchMode} batchSelected={batchSelected} toggleBatch={toggleBatch} />}
              {activeTab === 'nodes' && <NodesTab buckets={filtered} isNight={isNight} onSelect={openDetail} batchMode={batchMode} batchSelected={batchSelected} toggleBatch={toggleBatch} />}
              {activeTab === 'lines' && <LinesTab buckets={filtered} isNight={isNight} onSelect={openDetail} />}
              {activeTab === 'evolution' && <EvolutionTab buckets={filtered} isNight={isNight} onSelect={openDetail} batchMode={batchMode} batchSelected={batchSelected} toggleBatch={toggleBatch} />}
              {activeTab === 'star' && <StarMemoryTab isNight={isNight} />}
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
      <PaperActionDialog open={!!confirmAction} title={confirmAction?.kind==='purge'?`永久删除 ${confirmAction.ids.length} 个桶？`:'确认归档？'} confirmLabel={confirmAction?.kind==='purge'?'永久删除':'归档'} danger onClose={()=>setConfirmAction(null)} onConfirm={confirmDestructive}>
        {confirmAction?.kind==='purge'&&<p className="text-sm opacity-60">删除后不可恢复。</p>}
      </PaperActionDialog>
    </div>
  )
}

function StarMemoryTab({ isNight }: { isNight: boolean }) {
  const { currentUser } = useApp()
  const [status, setStatus] = useState<any>(null)
  const [candidates, setCandidates] = useState<StarCandidate[]>([])
  const [memories, setMemories] = useState<StarMemory[]>([])
  const [working, setWorking] = useState<StarWorkingMemory[]>([])
  const [families, setFamilies] = useState<StarFamily[]>([])
  const [familyTrash, setFamilyTrash] = useState<RecycledStarFamily[]>([])
  const [memoryTrash, setMemoryTrash] = useState<RecycledStarMemory[]>([])
  const [conflicts, setConflicts] = useState<StarMemoryConflict[]>([])
  const [resolvedSources, setResolvedSources] = useState<Record<string, ResolvedStarSource[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [section, setSection] = useState<StarSection>('timeline')
  const [starQuery, setStarQuery] = useState('')
  const [showCandidateForm, setShowCandidateForm] = useState(false)
  const [candidateDraft, setCandidateDraft] = useState({ type: 'shared_event', summary: '', details: '', importance: 5, familyId: '' })
  const [showFamilyForm, setShowFamilyForm] = useState(false)
  const [familyDraft, setFamilyDraft] = useState({ name: '', summary: '', parentId: '' })
  const [editingMemoryId, setEditingMemoryId] = useState('')
  const [memoryDraft, setMemoryDraft] = useState({ summary: '', details: '', whyImportant: '', currentUnderstanding: '', importance: 5 })
  const [familyPick, setFamilyPick] = useState<Record<string, string>>({})
  const [expandedFamilyId, setExpandedFamilyId] = useState('')
  const [familyDetails, setFamilyDetails] = useState<Record<string, StarFamilyDetail>>({})
  const [mergeTarget, setMergeTarget] = useState<Record<string, string>>({})
  const [splitSelections, setSplitSelections] = useState<Record<string, string[]>>({})
  const [deletingMemoryId, setDeletingMemoryId] = useState('')
  const [exportFamilyId, setExportFamilyId] = useState('')
  const [ombreImport, setOmbreImport] = useState<OmbreImportStatus | null>(null)
  const [candidateFilter, setCandidateFilter] = useState<'all' | 'ombre' | 'feel'>('all')
  const [candidateLimit, setCandidateLimit] = useState(30)
  const [editingCandidateId, setEditingCandidateId] = useState('')
  const [candidateEditDraft, setCandidateEditDraft] = useState({ type: 'observation', summary: '', details: '', importance: 5, familyIds: [] as string[] })
  const [favoriteMemoryIds, setFavoriteMemoryIds] = useState<Set<string>>(new Set())
  const [starDialog, setStarDialog] = useState<StarActionDialog | null>(null)
  const c = useColors(isNight)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [nextStatus, nextCandidates, nextMemories, nextWorking, nextFamilies, nextFamilyTrash, nextMemoryTrash, nextConflicts, nextOmbreImport] = await Promise.all([
        apiRequest('/api/star-memory?view=status'),
        apiRequest('/api/star-memory?view=candidates'),
        apiRequest('/api/star-memory?view=memories'),
        apiRequest('/api/star-memory?view=working'),
        apiRequest('/api/star-memory?view=families'),
        apiRequest('/api/star-memory?view=family_trash'),
        apiRequest('/api/star-memory?view=memory_trash'),
        apiRequest('/api/star-memory?view=conflicts'),
        apiRequest('/api/star-memory?view=ombre_import'),
      ])
      setStatus(nextStatus)
      setCandidates(Array.isArray(nextCandidates) ? nextCandidates : [])
      setMemories(Array.isArray(nextMemories) ? nextMemories : [])
      setWorking(Array.isArray(nextWorking) ? nextWorking : [])
      setFamilies(Array.isArray(nextFamilies) ? nextFamilies : [])
      setFamilyTrash(Array.isArray(nextFamilyTrash) ? nextFamilyTrash : [])
      setMemoryTrash(Array.isArray(nextMemoryTrash) ? nextMemoryTrash : [])
      setConflicts(Array.isArray(nextConflicts) ? nextConflicts : [])
      setOmbreImport(nextOmbreImport)
    } catch (loadError: any) {
      setError(loadError?.message || '新记忆库加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSources = async (id: string) => {
    if (resolvedSources[id]) return
    setBusyId(id)
    setError('')
    try {
      const sources = await apiRequest(`/api/star-memory?view=sources&id=${encodeURIComponent(id)}`)
      setResolvedSources(current => ({ ...current, [id]: Array.isArray(sources) ? sources : [] }))
    } catch (sourceError: any) {
      setError(sourceError?.message || '来源加载失败')
    } finally {
      setBusyId('')
    }
  }

  useEffect(() => { load() }, [load])
  useEffect(() => {
    apiRequest('/api/favorites?kind=memory').then((items: any[]) => setFavoriteMemoryIds(new Set((Array.isArray(items) ? items : []).map(item => item.targetKey)))).catch(() => {})
  }, [])

  const mutate = async (busyKey: string, body: Record<string, unknown>, fallback: string, after?: () => void) => {
    setBusyId(busyKey)
    setError('')
    try {
      await apiRequest('/api/star-memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      after?.()
      await load()
    } catch (mutationError: any) {
      setError(mutationError?.message || fallback)
    } finally {
      setBusyId('')
    }
  }

  const createManualCandidate = async () => {
    const summary = candidateDraft.summary.trim()
    if (!summary) return setError('请先写下要记住的内容')
    await mutate('new-candidate', {
      action: 'create_candidate',
      owner: 'fire',
      candidate: {
        type: candidateDraft.type,
        summary,
        details: candidateDraft.details.trim() || undefined,
        importance: candidateDraft.importance,
        familyIds: candidateDraft.familyId ? [candidateDraft.familyId] : [],
        sources: [{ kind: 'manual', actor: 'fire', label: '小火手动加入' }],
      },
    }, '候选创建失败', () => {
      setCandidateDraft({ type: 'shared_event', summary: '', details: '', importance: 5, familyId: '' })
      setShowCandidateForm(false)
    })
  }

  const createFamily = async () => {
    const name = familyDraft.name.trim()
    if (!name) return setError('请先填写家族名称')
    await mutate('new-family', {
      action: 'create_family',
      family: { name, summary: familyDraft.summary.trim() || undefined, parentId: familyDraft.parentId || undefined },
    }, '家族创建失败', () => {
      setFamilyDraft({ name: '', summary: '', parentId: '' })
      setShowFamilyForm(false)
    })
  }

  const importOmbre = async () => {
    if (!ombreImport?.remaining) return
    setBusyId('import-ombre')
    setError('')
    try {
      await apiRequest('/api/star-memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import_ombre' }),
      }, 120_000)
      setCandidateFilter('ombre')
      setCandidateLimit(30)
      await load()
    } catch (importError: any) {
      setError(importError?.message || '旧 Ombre 迁移失败')
    } finally {
      setBusyId('')
    }
  }

  const startEditingCandidate = (candidate: StarCandidate) => {
    setEditingCandidateId(candidate.id)
    setCandidateEditDraft({
      type: candidate.type,
      summary: candidate.summary,
      details: candidate.details || '',
      importance: candidate.importance || 5,
      familyIds: candidate.suggestedFamilyIds,
    })
  }

  const saveCandidate = (candidate: StarCandidate) => mutate(`edit-candidate-${candidate.id}`, {
    action: 'update_candidate', id: candidate.id,
    patch: {
      type: candidateEditDraft.type,
      summary: candidateEditDraft.summary.trim(),
      details: candidateEditDraft.details.trim() || undefined,
      importance: candidateEditDraft.importance,
      familyIds: candidateEditDraft.familyIds,
    },
  }, '候选修改失败', () => setEditingCandidateId(''))

  const candidateToJournal = (candidate: StarCandidate) => mutate(candidate.id, {
    action: 'candidate_to_journal', id: candidate.id,
  }, '存入星星日记失败')

  const startEditingMemory = (memory: StarMemory) => {
    setEditingMemoryId(memory.id)
    setMemoryDraft({
      summary: memory.summary,
      details: memory.details || '',
      whyImportant: memory.whyImportant || '',
      currentUnderstanding: memory.currentUnderstanding || '',
      importance: memory.importance || 5,
    })
  }

  const saveMemory = async (memory: StarMemory) => {
    const summary = memoryDraft.summary.trim()
    if (!summary) return setError('记忆摘要不能为空')
    await mutate(`edit-${memory.id}`, {
      action: 'update_memory', id: memory.id,
      patch: {
        summary,
        details: memoryDraft.details.trim() || undefined,
        whyImportant: memoryDraft.whyImportant.trim() || undefined,
        currentUnderstanding: memoryDraft.currentUnderstanding.trim() || undefined,
        importance: memoryDraft.importance,
      },
    }, '记忆修改失败', () => setEditingMemoryId(''))
  }

  const toggleMemoryLock = (memory: StarMemory) => mutate(`lock-${memory.id}`, {
    action: 'set_memory_lock', id: memory.id, locked: memory.lockOwner !== 'fire',
  }, '记忆锁定状态修改失败')

  const toggleMemoryFavorite = async (memory: StarMemory) => {
    const result = await apiRequest('/api/favorites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle', actor: currentUser, favorite: {
        kind: 'memory', targetKey: memory.id, title: memory.summary,
        content: [memory.details, memory.whyImportant && `为什么重要：${memory.whyImportant}`, memory.currentUnderstanding && `当前理解：${memory.currentUnderstanding}`].filter(Boolean).join('\n\n') || memory.summary,
        metadata: { memoryId: memory.id, type: memory.type, familyIds: memory.familyIds },
      } }),
    })
    setFavoriteMemoryIds(current => { const next = new Set(current); result.favorited ? next.add(memory.id) : next.delete(memory.id); return next })
  }

  const flagConflict = (memory: StarMemory) => setStarDialog({ kind: 'flag_conflict', memory, proposedSummary: memory.summary, reason: '' })

  const resolveConflict = (conflict: StarMemoryConflict, resolution: 'keep_current' | 'use_proposal') => mutate(`conflict-${conflict.id}`, {
    action: 'resolve_conflict', id: conflict.id, resolution,
  }, '纠错处理失败')

  const changeMemoryFamily = (memory: StarMemory, familyId: string, add: boolean) => {
    if (!familyId) return setError('请先选择一个家族')
    return mutate(`family-${memory.id}-${familyId}`, add
      ? { action: 'set_family_member', id: familyId, memoryId: memory.id, role: 'member' }
      : { action: 'remove_family_member', id: familyId, memoryId: memory.id },
    add ? '加入家族失败' : '移出家族失败', () => {
      if (add) setFamilyPick(current => ({ ...current, [memory.id]: '' }))
    })
  }

  const toggleFamilyDetails = async (familyId: string) => {
    if (expandedFamilyId === familyId) return setExpandedFamilyId('')
    setExpandedFamilyId(familyId)
    if (familyDetails[familyId]) return
    setBusyId(`detail-${familyId}`)
    setError('')
    try {
      const detail = await apiRequest(`/api/star-memory?view=family&level=4&id=${encodeURIComponent(familyId)}`)
      setFamilyDetails(current => ({ ...current, [familyId]: detail }))
    } catch (detailError: any) {
      setError(detailError?.message || '家族内容加载失败')
    } finally {
      setBusyId('')
    }
  }

  const updateFamilyMember = (familyId: string, memoryId: string, role?: StarFamilyRole) => mutate(`member-${familyId}-${memoryId}`, role
    ? { action: 'set_family_member', id: familyId, memoryId, role }
    : { action: 'remove_family_member', id: familyId, memoryId },
  role ? '成员角色修改失败' : '移出家族失败', () => setFamilyDetails(current => {
    const detail = current[familyId]
    if (!detail) return current
    return { ...current, [familyId]: role
      ? { ...detail, memberships: detail.memberships.map(link => link.memoryId === memoryId ? { ...link, role } : link) }
      : { ...detail, memberships: detail.memberships.filter(link => link.memoryId !== memoryId), memories: detail.memories.filter(memory => memory.id !== memoryId) } }
  }))

  const mergeFamily = (family: StarFamily) => {
    const targetId = mergeTarget[family.id]
    if (!targetId) return setError('请先选择要合并到的家族')
    setStarDialog({ kind: 'merge_family', family, targetId })
  }

  const splitFamily = (family: StarFamily) => {
    const memoryIds = splitSelections[family.id] || []
    if (memoryIds.length === 0) return setError('请先勾选要拆出的记忆')
    setStarDialog({ kind: 'split_family', family, name: '' })
  }

  const review = async (id: string, decision: 'approve' | 'reject') => {
    setBusyId(id)
    setError('')
    try {
      const response = await fetch('/api/star-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'review_candidate', id, decision, actor: 'fire' }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '审核失败')
      await load()
    } catch (reviewError: any) {
      setError(reviewError?.message || '审核失败')
    } finally {
      setBusyId('')
    }
  }

  const reviewWorking = async (id: string, decision: 'dismiss' | 'observe' | 'promote' | 'ask_fire') => {
    setBusyId(id)
    setError('')
    try {
      const response = await fetch('/api/star-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'review_working', id, decision }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '短期记忆整理失败')
      await load()
    } catch (reviewError: any) {
      setError(reviewError?.message || '短期记忆整理失败')
    } finally {
      setBusyId('')
    }
  }

  const manageFamily = async (family: StarFamily, action: 'update_family' | 'set_family_lock' | 'end_family' | 'recycle_family') => {
    if (action !== 'set_family_lock') {
      setStarDialog({ kind: 'manage_family', family, action, summary: family.summary || '' })
      return
    }
    setBusyId(family.id)
    setError('')
    try {
      const response = await fetch('/api/star-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, id: family.id, locked: !family.lockOwner }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '家族更新失败')
      await load()
    } catch (familyError: any) {
      setError(familyError?.message || '家族更新失败')
    } finally {
      setBusyId('')
    }
  }

  const confirmStarDialog = async () => {
    const dialog = starDialog
    if (!dialog) return
    if (dialog.kind === 'import_ombre') {
      setStarDialog(null)
      await importOmbre()
      return
    }
    if (dialog.kind === 'flag_conflict') {
      const proposedSummary = dialog.proposedSummary.trim()
      if (!proposedSummary || proposedSummary === dialog.memory.summary) return setError('请写下不同的准确版本')
      setStarDialog(null)
      await mutate(`conflict-${dialog.memory.id}`, {
        action: 'flag_conflict', memoryId: dialog.memory.id, proposedSummary, reason: dialog.reason.trim() || undefined,
      }, '纠错项创建失败', () => setSection('conflicts'))
      return
    }
    if (dialog.kind === 'merge_family') {
      setStarDialog(null)
      await mutate(`merge-${dialog.family.id}`, { action: 'merge_families', sourceId: dialog.family.id, targetId: dialog.targetId }, '家族合并失败', () => {
        setExpandedFamilyId('')
        setFamilyDetails(current => { const next = { ...current }; delete next[dialog.family.id]; delete next[dialog.targetId]; return next })
        setMergeTarget(current => ({ ...current, [dialog.family.id]: '' }))
      })
      return
    }
    if (dialog.kind === 'split_family') {
      const name = dialog.name.trim()
      if (!name) return setError('请填写新家族名称')
      const memoryIds = splitSelections[dialog.family.id] || []
      setStarDialog(null)
      await mutate(`split-${dialog.family.id}`, { action: 'split_family', sourceId: dialog.family.id, family: { name }, memoryIds }, '家族拆分失败', () => {
        setFamilyDetails(current => { const next = { ...current }; delete next[dialog.family.id]; return next })
        setExpandedFamilyId('')
        setSplitSelections(current => ({ ...current, [dialog.family.id]: [] }))
      })
      return
    }
    setStarDialog(null)
    await mutate(dialog.family.id, dialog.action === 'update_family'
      ? { action: dialog.action, id: dialog.family.id, patch: { summary: dialog.summary.trim() || undefined } }
      : { action: dialog.action, id: dialog.family.id }, '家族更新失败')
  }

  const restoreFamily = async (recycleId: string) => {
    setBusyId(recycleId)
    setError('')
    try {
      const response = await fetch('/api/star-memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore_family', recycleId }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '恢复家族失败')
      await load()
    } catch (restoreError: any) {
      setError(restoreError?.message || '恢复家族失败')
    } finally {
      setBusyId('')
    }
  }

  const recycleMemory = async (memory: StarMemory) => {
    setBusyId(memory.id)
    setError('')
    try {
      const response = await fetch('/api/star-memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'recycle_memory', id: memory.id }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '删除正式记忆失败')
      setDeletingMemoryId('')
      await load()
    } catch (recycleError: any) {
      setError(recycleError?.message || '删除正式记忆失败')
    } finally {
      setBusyId('')
    }
  }

  const restoreMemory = async (recycleId: string) => {
    setBusyId(recycleId)
    setError('')
    try {
      const response = await fetch('/api/star-memory', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'restore_memory', recycleId }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '恢复正式记忆失败')
      await load()
    } catch (restoreError: any) {
      setError(restoreError?.message || '恢复正式记忆失败')
    } finally {
      setBusyId('')
    }
  }

  if (loading) return <div className={`text-center py-12 text-sm ${c.muted}`}>加载新记忆库…</div>
  const openCandidates = candidates.filter(item => !['approved', 'rejected', 'journaled'].includes(item.status))
  const filteredCandidates = openCandidates.filter(candidate => {
    const source = candidate.sources.find(item => item.kind === 'ombre')
    if (candidateFilter === 'ombre') return !!source
    if (candidateFilter === 'feel') return source?.label?.includes('感受')
    return true
  })
  const activeWorking = working.filter(item => ['active', 'due'].includes(item.status))
  const familyNames = new Map(families.map(family => [family.id, family.name]))
  const familyTreeRows: Array<{ family: StarFamily; depth: number }> = []
  const addedFamilyIds = new Set<string>()
  const addFamilyBranch = (family: StarFamily, depth: number) => {
    if (addedFamilyIds.has(family.id)) return
    addedFamilyIds.add(family.id)
    familyTreeRows.push({ family, depth })
    families.filter(child => child.parentId === family.id).forEach(child => addFamilyBranch(child, depth + 1))
  }
  families.filter(family => !family.parentId).forEach(family => addFamilyBranch(family, 0))
  families.filter(family => !addedFamilyIds.has(family.id)).forEach(family => addFamilyBranch(family, 0))
  const timeline = [
    ...memories.map(item => ({ id: item.id, kind: '正式记忆', summary: item.summary, date: item.occurredAt || item.createdAt, familyIds: item.familyIds, target: 'memories' as StarSection })),
    ...activeWorking.map(item => ({ id: item.id, kind: '近期记忆', summary: item.summary, date: item.createdAt, familyIds: item.suggestedFamilyIds, target: 'current' as StarSection })),
  ].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  const searchNeedle = starQuery.trim().toLocaleLowerCase('zh-CN')
  const searchResults = searchNeedle ? [
    ...memories.map(item => ({ id: item.id, kind: '正式记忆', title: item.summary, detail: item.details || '', target: 'memories' as StarSection })),
    ...activeWorking.map(item => ({ id: item.id, kind: '近期记忆', title: item.summary, detail: '', target: 'current' as StarSection })),
    ...openCandidates.map(item => ({ id: item.id, kind: '待审核', title: item.summary, detail: item.details || '', target: 'inbox' as StarSection })),
    ...conflicts.map(item => ({ id: item.id, kind: '待纠错', title: item.proposedSummary, detail: `${item.currentSummary} ${item.reason || ''}`, target: 'conflicts' as StarSection })),
    ...families.map(item => ({ id: item.id, kind: '记忆家族', title: item.name, detail: item.summary || '', target: 'families' as StarSection })),
  ].filter(item => `${item.title} ${item.detail}`.toLocaleLowerCase('zh-CN').includes(searchNeedle)) : []
  const unresolved = [...memories, ...openCandidates].filter(item => item.type === 'unresolved')

  return (
    <div className="space-y-3 pt-2">
      <div className={`rounded-xl border ${c.border} p-3`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className={`text-xs font-medium ${c.accent}`}>星星记忆库</div>
            <div className={`mt-1 text-[10px] ${c.muted}`}>新库独立运行，旧 Ombre 记忆仍未停用</div>
          </div>
          <button onClick={load} aria-label="刷新新记忆库" className={`rounded-lg p-2 ${c.surface} ${c.muted}`}><RefreshCw size={13} /></button>
        </div>
        <div className={`mt-3 grid grid-cols-4 gap-2 text-center text-[10px] ${c.muted}`}>
          <button onClick={() => setSection('current')} className={`rounded-lg py-2 ${c.surface}`}><span className="block text-sm">{status?.workingActive || 0}</span>近期</button>
          <button onClick={() => setSection('current')} className={`rounded-lg py-2 ${c.surface}`}><span className="block text-sm">{status?.workingDue || 0}</span>待整理</button>
          <button onClick={() => setSection('inbox')} className={`rounded-lg py-2 ${c.surface}`}><span className="block text-sm">{status?.pendingFire || 0}</span>等小火</button>
          <button onClick={() => setSection('memories')} className={`rounded-lg py-2 ${c.surface}`}><span className="block text-sm">{status?.memories || 0}</span>正式记忆</button>
        </div>
      </div>

      <div role="tablist" aria-label="新记忆库视图" className="flex gap-1 overflow-x-auto pb-1">
        {STAR_SECTIONS.map(item => <button key={item.key} role="tab" aria-selected={section === item.key} onClick={() => setSection(item.key)} className={`shrink-0 rounded-lg px-3 py-1.5 text-[10px] ${section === item.key ? `${c.accentBg} ${c.accent} font-medium` : `${c.surface} ${c.muted}`}`}>{item.label}{item.key === 'inbox' && openCandidates.length > 0 ? ` ${openCandidates.length}` : item.key === 'conflicts' && conflicts.length > 0 ? ` ${conflicts.length}` : ''}</button>)}
      </div>

      {error && <div className="rounded-xl bg-red-500/10 px-3 py-2 text-[11px] text-red-500">{error}</div>}

      {section === 'timeline' && <div>
        <div className={`mb-2 text-[11px] font-medium ${c.accent}`}>时间线</div>
        {timeline.length === 0 ? <div className={`rounded-xl border ${c.border} py-8 text-center text-xs ${c.muted}`}>暂无可显示的记忆</div> : <div className={`ml-2 space-y-0 border-l ${c.border}`}>
          {timeline.map(item => <button key={`${item.kind}-${item.id}`} onClick={() => setSection(item.target)} className="relative block w-full py-2 pl-4 text-left">
            <span className={`absolute -left-1 top-4 h-2 w-2 rounded-full ${c.accentBg}`} />
            <span className={`text-[9px] ${c.muted}`}>{item.date?.slice(0, 10) || '日期未记录'} · {item.kind}</span>
            <span className="mt-0.5 block text-xs leading-5">{item.summary}</span>
            {item.familyIds.length > 0 && <span className={`mt-1 block text-[9px] ${c.muted}`}>{item.familyIds.map(id => familyNames.get(id)).filter(Boolean).join('、')}</span>}
          </button>)}
        </div>}
      </div>}

      {section === 'search' && <div>
        <label className={`mb-2 block text-[11px] font-medium ${c.accent}`} htmlFor="star-memory-search">搜索新记忆库</label>
        <div className={`flex items-center gap-2 rounded-xl border ${c.border} px-3 py-2`}><Search size={13} className={c.muted} /><input id="star-memory-search" value={starQuery} onChange={event => setStarQuery(event.target.value)} placeholder="搜记忆、候选或家族" className="min-w-0 flex-1 bg-transparent text-xs outline-none" /></div>
        {!searchNeedle ? <div className={`py-8 text-center text-xs ${c.muted}`}>输入关键词开始搜索</div> : searchResults.length === 0 ? <div className={`py-8 text-center text-xs ${c.muted}`}>没有找到匹配内容</div> : <div className="mt-2 space-y-2">{searchResults.map(item => <button key={`${item.kind}-${item.id}`} onClick={() => setSection(item.target)} className={`block w-full rounded-xl border ${c.border} p-3 text-left`}><span className={`text-[9px] ${c.muted}`}>{item.kind}</span><span className="mt-1 block text-xs">{item.title}</span>{item.detail && <span className={`mt-1 line-clamp-2 block text-[10px] ${c.muted}`}>{item.detail}</span>}</button>)}</div>}
      </div>}

      {section === 'current' && <div>
        <div className={`mb-2 text-[11px] font-medium ${c.accent}`}>短期活跃记忆</div>
        {activeWorking.length === 0 ? <div className={`rounded-xl border ${c.border} py-8 text-center text-xs ${c.muted}`}>暂无近期内容</div> : (
          <div className="space-y-2">
            {activeWorking.map(item => (
              <article key={item.id} className={`rounded-xl border ${c.border} p-3`}>
                <div className={`text-[10px] ${c.muted}`}>{item.type} · {item.retentionDays} 天 · {item.status === 'due' ? '待整理' : `到期 ${item.expiresAt.slice(0, 10)}`}</div>
                <p className="mt-1 text-xs leading-5">{item.summary}</p>
                {item.suggestedFamilyIds.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{item.suggestedFamilyIds.map(id => <span key={id} className={`rounded px-1.5 py-0.5 text-[9px] ${c.accentBg} ${c.accent}`}>{familyNames.get(id) || '未知家族'}</span>)}</div>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={busyId === item.id} onClick={() => reviewWorking(item.id, 'promote')} className={`rounded-lg px-3 py-1.5 text-[10px] font-medium ${c.accentBg} ${c.accent} disabled:opacity-40`}>升格</button>
                  {item.status === 'due' && item.retentionDays < 14 && <button disabled={busyId === item.id} onClick={() => reviewWorking(item.id, 'observe')} className={`rounded-lg px-3 py-1.5 text-[10px] ${c.surface} ${c.muted} disabled:opacity-40`}>观察到14天</button>}
                  <button disabled={busyId === item.id} onClick={() => reviewWorking(item.id, 'ask_fire')} className={`rounded-lg px-3 py-1.5 text-[10px] ${c.surface} ${c.muted} disabled:opacity-40`}>交给小火</button>
                  <button disabled={busyId === item.id} onClick={() => reviewWorking(item.id, 'dismiss')} className={`rounded-lg px-3 py-1.5 text-[10px] ${c.surface} ${c.muted} disabled:opacity-40`}>退出活跃</button>
                </div>
              </article>
            ))}
          </div>
        )}
        <div className={`mb-2 mt-4 text-[11px] font-medium ${c.accent}`}>未完事项</div>
        {unresolved.length === 0 ? <div className={`rounded-xl border ${c.border} py-6 text-center text-xs ${c.muted}`}>暂无未完事项</div> : <div className="space-y-2">{unresolved.map(item => <div key={item.id} className={`rounded-xl border ${c.border} p-3 text-xs`}>{item.summary}</div>)}</div>}
      </div>}

      {section === 'inbox' && <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className={`text-[11px] font-medium ${c.accent}`}>候选收件箱</div>
          <button onClick={() => setShowCandidateForm(value => !value)} className={`rounded-lg px-3 py-1.5 text-[10px] ${c.accentBg} ${c.accent}`}>{showCandidateForm ? '取消' : '手动加入'}</button>
        </div>
        {showCandidateForm && <form onSubmit={event => { event.preventDefault(); createManualCandidate() }} className={`mb-3 space-y-2 rounded-xl border ${c.border} p-3`}>
          <div className="grid grid-cols-2 gap-2">
            <label className={`text-[10px] ${c.muted}`}>类型
              <select value={candidateDraft.type} onChange={event => setCandidateDraft(current => ({ ...current, type: event.target.value }))} className={`mt-1 w-full rounded-lg border ${c.border} ${c.surface} px-2 py-2 text-xs`}>
                <option value="shared_event">共同经历</option><option value="durable_fact">稳定事实</option><option value="agreement">承诺约定</option><option value="current_state">当前状态</option><option value="observation">观察</option><option value="self_event">星星经历</option><option value="unresolved">未完事项</option>
              </select>
            </label>
            <label className={`text-[10px] ${c.muted}`}>重要度
              <input type="number" min="1" max="10" value={candidateDraft.importance} onChange={event => setCandidateDraft(current => ({ ...current, importance: Number(event.target.value) }))} className={`mt-1 w-full rounded-lg border ${c.border} ${c.surface} px-2 py-2 text-xs`} />
            </label>
          </div>
          <label className={`block text-[10px] ${c.muted}`}>记忆摘要
            <textarea required maxLength={1000} value={candidateDraft.summary} onChange={event => setCandidateDraft(current => ({ ...current, summary: event.target.value }))} className={`mt-1 min-h-20 w-full rounded-lg border ${c.border} ${c.surface} px-3 py-2 text-xs leading-5`} placeholder="写下最核心、最准确的骨架" />
          </label>
          <label className={`block text-[10px] ${c.muted}`}>细节（可选）
            <textarea maxLength={6000} value={candidateDraft.details} onChange={event => setCandidateDraft(current => ({ ...current, details: event.target.value }))} className={`mt-1 min-h-16 w-full rounded-lg border ${c.border} ${c.surface} px-3 py-2 text-xs leading-5`} />
          </label>
          <label className={`block text-[10px] ${c.muted}`}>先放进家族（可选）
            <select value={candidateDraft.familyId} onChange={event => setCandidateDraft(current => ({ ...current, familyId: event.target.value }))} className={`mt-1 w-full rounded-lg border ${c.border} ${c.surface} px-2 py-2 text-xs`}>
              <option value="">暂不归类</option>{families.filter(family => !['ended', 'archived'].includes(family.status) && family.lockOwner !== 'star').map(family => <option key={family.id} value={family.id}>{family.name}</option>)}
            </select>
          </label>
          <div className={`text-[9px] ${c.muted}`}>会标记为“小火手动加入”，先进入待审核区，批准后自动加小火个人锁。</div>
          <button disabled={busyId === 'new-candidate'} className={`rounded-lg px-3 py-1.5 text-[10px] font-medium ${c.accentBg} ${c.accent} disabled:opacity-40`}>保存为候选</button>
        </form>}
        {ombreImport && <div className={`mb-3 rounded-xl border ${c.border} p-3`}>
          <div className="flex items-center justify-between gap-3"><div><div className="text-[11px] font-medium">旧 Ombre 迁移</div><div className={`mt-1 text-[9px] ${c.muted}`}>共 {ombreImport.total} 个 · 已登记 {ombreImport.imported} 个 · 剩余 {ombreImport.remaining} 个{ombreImport.feelings ? ` · 其中感受 ${ombreImport.feelings} 个` : ''}</div></div>{ombreImport.remaining > 0 && <button disabled={busyId === 'import-ombre'} onClick={() => setStarDialog({ kind: 'import_ombre' })} className={`rounded-lg px-3 py-1.5 text-[10px] ${c.accentBg} ${c.accent} disabled:opacity-40`}>全部放入待审核</button>}</div>
          <div className={`mt-2 text-[9px] leading-4 ${c.muted}`}>感受类会标记“建议存入星星日记”；所有旧桶保持原样，重复扫描不会重复导入。</div>
        </div>}
        <div className="mb-2 flex gap-1">{([['all', '全部'], ['ombre', '旧 Ombre'], ['feel', '建议进日记']] as const).map(([key, label]) => <button key={key} onClick={() => { setCandidateFilter(key); setCandidateLimit(30) }} className={`rounded-lg px-2 py-1 text-[9px] ${candidateFilter === key ? `${c.accentBg} ${c.accent}` : `${c.surface} ${c.muted}`}`}>{label}</button>)}</div>
        {filteredCandidates.length === 0 ? <div className={`rounded-xl border ${c.border} py-8 text-center text-xs ${c.muted}`}>暂无待审核候选</div> : (
          <div className="space-y-2">
            {filteredCandidates.slice(0, candidateLimit).map(candidate => {
              const ombreSource = candidate.sources.find(source => source.kind === 'ombre')
              const isOmbreFeeling = !!ombreSource?.label?.includes('感受')
              return (
              <article key={candidate.id} className={`rounded-xl border ${c.border} p-3`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className={`text-[10px] ${c.muted}`}>{candidate.type} · 重要度 {candidate.importance || 5} · {candidate.owner === 'fire' ? '等小火' : '等星星'}{candidate.lockOwner ? ` · 🔒 ${candidate.lockOwner === 'star' ? '星星' : '小火'}` : ''}</div>
                    <p className="mt-1 text-xs leading-5">{candidate.summary}</p>
                  </div>
                </div>
                {candidate.suggestedFamilyIds.length > 0 && <div className="mt-2 flex flex-wrap gap-1">
                  {candidate.suggestedFamilyIds.map(id => <span key={id} className={`rounded px-1.5 py-0.5 text-[9px] ${c.accentBg} ${c.accent}`}>{familyNames.get(id) || '未知家族'}</span>)}
                </div>}
                {editingCandidateId === candidate.id && <form onSubmit={event => { event.preventDefault(); saveCandidate(candidate) }} className={`mt-3 space-y-2 rounded-xl ${c.surface} p-3`}>
                  <div className="grid grid-cols-2 gap-2"><label className={`text-[9px] ${c.muted}`}>类型<select value={candidateEditDraft.type} onChange={event => setCandidateEditDraft(current => ({ ...current, type: event.target.value }))} className={`mt-1 w-full rounded-lg border ${c.border} bg-transparent px-2 py-1.5 text-[10px]`}><option value="shared_event">共同经历</option><option value="durable_fact">稳定事实</option><option value="agreement">承诺约定</option><option value="current_state">当前状态</option><option value="observation">观察</option><option value="self_event">星星经历</option><option value="unresolved">未完事项</option></select></label><label className={`text-[9px] ${c.muted}`}>重要度<input type="number" min="1" max="10" value={candidateEditDraft.importance} onChange={event => setCandidateEditDraft(current => ({ ...current, importance: Number(event.target.value) }))} className={`mt-1 w-full rounded-lg border ${c.border} bg-transparent px-2 py-1.5 text-[10px]`} /></label></div>
                  <textarea required maxLength={1000} aria-label="候选摘要" value={candidateEditDraft.summary} onChange={event => setCandidateEditDraft(current => ({ ...current, summary: event.target.value }))} className={`min-h-16 w-full rounded-lg border ${c.border} bg-transparent px-2 py-2 text-[10px]`} />
                  <textarea maxLength={6000} aria-label="候选细节" value={candidateEditDraft.details} onChange={event => setCandidateEditDraft(current => ({ ...current, details: event.target.value }))} className={`min-h-20 w-full rounded-lg border ${c.border} bg-transparent px-2 py-2 text-[10px]`} />
                  {families.length > 0 && <div><div className={`mb-1 text-[9px] ${c.muted}`}>家族（可多选）</div><div className="flex flex-wrap gap-1">{families.filter(family => !['ended', 'archived'].includes(family.status)).map(family => <label key={family.id} className={`flex items-center gap-1 rounded px-2 py-1 text-[9px] ${c.accentBg}`}><input type="checkbox" checked={candidateEditDraft.familyIds.includes(family.id)} onChange={() => setCandidateEditDraft(current => ({ ...current, familyIds: current.familyIds.includes(family.id) ? current.familyIds.filter(id => id !== family.id) : [...current.familyIds, family.id] }))} />{family.name}</label>)}</div></div>}
                  <div className="flex gap-2"><button disabled={!candidateEditDraft.summary.trim() || busyId === `edit-candidate-${candidate.id}`} className={`rounded-lg px-2 py-1 text-[9px] ${c.accentBg} ${c.accent} disabled:opacity-40`}>保存修改</button><button type="button" onClick={() => setEditingCandidateId('')} className={`text-[9px] ${c.muted}`}>取消</button></div>
                </form>}
                {(candidate.whyImportant || candidate.details || candidate.sources.length > 0) && <details className="mt-2">
                  <summary className={`cursor-pointer text-[10px] ${c.muted}`}>依据与细节</summary>
                  <div className={`mt-2 space-y-2 border-l pl-2 text-[10px] leading-4 ${c.border} ${c.muted}`}>
                    {candidate.whyImportant && <p>为什么重要：{candidate.whyImportant}</p>}
                    {candidate.details && <p>{candidate.details}</p>}
                    {candidate.sources.map((source, index) => <div key={`${candidate.id}-source-${index}`}><div>{source.label || `${source.actor} 提供`}</div>{source.excerpt && <p className="mt-1 whitespace-pre-wrap opacity-80">{source.excerpt}</p>}</div>)}
                  </div>
                </details>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button disabled={busyId === candidate.id} onClick={() => review(candidate.id, 'approve')} className={`rounded-lg px-3 py-1.5 text-[10px] font-medium ${c.accentBg} ${c.accent} disabled:opacity-40`}>{isOmbreFeeling ? '存为正式记忆' : '批准'}</button>
                  {isOmbreFeeling && <button disabled={busyId === candidate.id} onClick={() => candidateToJournal(candidate)} className={`rounded-lg px-3 py-1.5 text-[10px] ${c.accentBg} ${c.accent} disabled:opacity-40`}>存入星星日记</button>}
                  <button disabled={busyId === candidate.id} onClick={() => startEditingCandidate(candidate)} className={`rounded-lg px-3 py-1.5 text-[10px] ${c.surface} ${c.muted} disabled:opacity-40`}>编辑后再审</button>
                  <button disabled={busyId === candidate.id} onClick={() => review(candidate.id, 'reject')} className={`rounded-lg px-3 py-1.5 text-[10px] ${c.surface} ${c.muted} disabled:opacity-40`}>不保留</button>
                </div>
              </article>
            )})}
            {filteredCandidates.length > candidateLimit && <button onClick={() => setCandidateLimit(limit => limit + 30)} className={`w-full rounded-xl border ${c.border} py-2 text-[10px] ${c.muted}`}>再显示 30 条（剩余 {filteredCandidates.length - candidateLimit} 条）</button>}
          </div>
        )}
      </div>}

      {section === 'memories' && <div>
        <div className={`mb-2 text-[11px] font-medium ${c.accent}`}>正式记忆</div>
        {memories.length === 0 ? <div className={`rounded-xl border ${c.border} py-8 text-center text-xs ${c.muted}`}>暂无正式记忆</div> : (
          <div className="space-y-2">
            {memories.map(item => (
              <article key={item.id} className={`rounded-xl border ${c.border} p-3`}>
                <div className={`text-[10px] ${c.muted}`}>{item.type} · 重要度 {item.importance || 5} · {item.approvedBy === 'star' ? '星星确认' : '小火确认'}{item.lockOwner ? ` · 🔒 ${item.lockOwner === 'star' ? '星星' : '小火'}` : ''}</div>
                <p className="mt-1 text-xs leading-5">{item.summary}</p>
                {editingMemoryId === item.id && <form onSubmit={event => { event.preventDefault(); saveMemory(item) }} className={`mt-3 space-y-2 rounded-xl ${c.surface} p-3`}>
                  <label className={`block text-[10px] ${c.muted}`}>摘要
                    <textarea required maxLength={1000} value={memoryDraft.summary} onChange={event => setMemoryDraft(current => ({ ...current, summary: event.target.value }))} className={`mt-1 min-h-16 w-full rounded-lg border ${c.border} bg-transparent px-3 py-2 text-xs`} />
                  </label>
                  <label className={`block text-[10px] ${c.muted}`}>细节
                    <textarea maxLength={6000} value={memoryDraft.details} onChange={event => setMemoryDraft(current => ({ ...current, details: event.target.value }))} className={`mt-1 min-h-16 w-full rounded-lg border ${c.border} bg-transparent px-3 py-2 text-xs`} />
                  </label>
                  <label className={`block text-[10px] ${c.muted}`}>为什么重要
                    <textarea maxLength={1000} value={memoryDraft.whyImportant} onChange={event => setMemoryDraft(current => ({ ...current, whyImportant: event.target.value }))} className={`mt-1 min-h-12 w-full rounded-lg border ${c.border} bg-transparent px-3 py-2 text-xs`} />
                  </label>
                  <label className={`block text-[10px] ${c.muted}`}>当前理解
                    <textarea maxLength={1500} value={memoryDraft.currentUnderstanding} onChange={event => setMemoryDraft(current => ({ ...current, currentUnderstanding: event.target.value }))} className={`mt-1 min-h-12 w-full rounded-lg border ${c.border} bg-transparent px-3 py-2 text-xs`} />
                  </label>
                  <label className={`block text-[10px] ${c.muted}`}>重要度
                    <input type="number" min="1" max="10" value={memoryDraft.importance} onChange={event => setMemoryDraft(current => ({ ...current, importance: Number(event.target.value) }))} className={`mt-1 w-24 rounded-lg border ${c.border} bg-transparent px-2 py-2 text-xs`} />
                  </label>
                  <div className="flex gap-2"><button disabled={busyId === `edit-${item.id}`} className={`rounded-lg px-3 py-1.5 text-[10px] font-medium ${c.accentBg} ${c.accent} disabled:opacity-40`}>保存修改</button><button type="button" onClick={() => setEditingMemoryId('')} className={`rounded-lg px-3 py-1.5 text-[10px] ${c.surface} ${c.muted}`}>取消</button></div>
                </form>}
                {item.familyIds.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{item.familyIds.map(id => {
                  const family = families.find(value => value.id === id)
                  const blocked = item.lockOwner === 'star' || family?.lockOwner === 'star'
                  return <span key={id} className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] ${c.accentBg} ${c.accent}`}>{family?.name || '未知家族'}<button aria-label={`从${family?.name || '家族'}移出`} disabled={blocked || busyId === `family-${item.id}-${id}`} onClick={() => changeMemoryFamily(item, id, false)} className="disabled:opacity-30">×</button></span>
                })}</div>}
                {item.lockOwner !== 'star' && families.some(family => !item.familyIds.includes(family.id) && !['ended', 'archived'].includes(family.status) && family.lockOwner !== 'star') && <div className="mt-2 flex gap-2">
                  <select aria-label="选择要加入的记忆家族" value={familyPick[item.id] || ''} onChange={event => setFamilyPick(current => ({ ...current, [item.id]: event.target.value }))} className={`min-w-0 flex-1 rounded-lg border ${c.border} ${c.surface} px-2 py-1.5 text-[10px]`}><option value="">加入家族…</option>{families.filter(family => !item.familyIds.includes(family.id) && !['ended', 'archived'].includes(family.status) && family.lockOwner !== 'star').map(family => <option key={family.id} value={family.id}>{family.name}</option>)}</select>
                  <button disabled={!familyPick[item.id] || busyId.startsWith(`family-${item.id}-`)} onClick={() => changeMemoryFamily(item, familyPick[item.id], true)} className={`rounded-lg px-3 py-1.5 text-[10px] ${c.surface} ${c.muted} disabled:opacity-40`}>加入</button>
                </div>}
                {editingMemoryId !== item.id && <details className="mt-2">
                  <summary className={`cursor-pointer text-[10px] ${c.muted}`}>详情与来源</summary>
                  <div className={`mt-2 space-y-2 border-l pl-2 text-[10px] leading-4 ${c.border} ${c.muted}`}>
                    {item.whyImportant && <p>为什么重要：{item.whyImportant}</p>}
                    {item.details && <p>{item.details}</p>}
                    {item.currentUnderstanding && <p>当前理解：{item.currentUnderstanding}</p>}
                    <p>有效时间：{item.validFrom?.slice(0, 10) || '未限定'} → {item.validTo?.slice(0, 10) || '仍有效'}{item.occurredAt ? ` · 发生于 ${item.occurredAt.slice(0, 10)}` : ''}</p>
                    <button disabled={busyId === item.id} onClick={() => loadSources(item.id)} className={`rounded px-2 py-1 ${c.surface} disabled:opacity-40`}>{resolvedSources[item.id] ? '来源已展开' : '查看原始来源'}</button>
                    {resolvedSources[item.id]?.map((group, index) => <div key={`${item.id}-resolved-${index}`} className={`rounded-lg p-2 ${c.surface}`}><div>{group.source.label || group.source.kind}{group.missing ? ' · 有来源缺失' : ''}</div>{group.resolved.map((message, messageIndex) => <p key={message.id || messageIndex} className="mt-1 whitespace-pre-wrap opacity-80">{message.role === 'user' ? '小火' : message.role === 'assistant' ? '星星' : '来源'}：{message.content}</p>)}</div>)}
                  </div>
                </details>}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button onClick={() => toggleMemoryFavorite(item)} title={favoriteMemoryIds.has(item.id) ? '取消收藏' : '收藏'} className={`rounded-lg px-2 py-1 text-[9px] ${c.surface} ${c.muted}`}><Heart className="mr-1 inline" size={10} fill={favoriteMemoryIds.has(item.id) ? 'currentColor' : 'none'} />{favoriteMemoryIds.has(item.id) ? '已收藏' : '收藏'}</button>
                  <button disabled={item.lockOwner === 'star'} onClick={() => startEditingMemory(item)} className={`rounded-lg px-2 py-1 text-[9px] ${c.surface} ${c.muted} disabled:opacity-40`}>{item.lockOwner === 'star' ? '星星锁定' : '编辑'}</button>
                  <button disabled={busyId === `lock-${item.id}` || item.lockOwner === 'star'} onClick={() => toggleMemoryLock(item)} className={`rounded-lg px-2 py-1 text-[9px] ${c.surface} ${c.muted} disabled:opacity-40`}>{item.lockOwner === 'star' ? '不可解锁' : item.lockOwner === 'fire' ? '解除小火锁' : '加小火锁'}</button>
                  <button disabled={busyId === `conflict-${item.id}`} onClick={() => flagConflict(item)} className={`rounded-lg px-2 py-1 text-[9px] ${c.surface} ${c.muted} disabled:opacity-40`}>纠错</button>
                  <button disabled={busyId === item.id || item.lockOwner === 'star'} onClick={() => setDeletingMemoryId(current => current === item.id ? '' : item.id)} className={`rounded-lg px-2 py-1 text-[9px] ${c.surface} ${c.muted} disabled:opacity-40`}>{item.lockOwner === 'star' ? '星星锁定' : '删除…'}</button>
                </div>
                {deletingMemoryId === item.id && <div className={`mt-2 space-y-2 rounded-lg border ${c.border} p-2`}>
                  <div className={`text-[10px] ${c.muted}`}>选择删除范围</div>
                  {item.familyIds.map(id => <button key={id} disabled={busyId === `family-${item.id}-${id}` || families.find(family => family.id === id)?.lockOwner === 'star'} onClick={() => changeMemoryFamily(item, id, false)} className={`mr-2 rounded-lg px-2 py-1 text-[9px] ${c.surface} ${c.muted} disabled:opacity-40`}>只从“{familyNames.get(id) || '未知家族'}”移出</button>)}
                  <button disabled={busyId === item.id} onClick={() => recycleMemory(item)} className="block rounded-lg bg-red-500/10 px-2 py-1 text-[9px] text-red-500 disabled:opacity-40">删除整条正式记忆</button>
                  <div className={`text-[9px] leading-4 ${c.muted}`}>整条删除会把正文、索引、来源引用、原话和家族关系一起放进 24 小时回收区；原始聊天或原始资料不会被这个后台删除。</div>
                  <button onClick={() => setDeletingMemoryId('')} className={`text-[9px] ${c.muted}`}>取消</button>
                </div>}
              </article>
            ))}
          </div>
        )}
      </div>}

      {section === 'conflicts' && <div>
        <div className={`mb-2 text-[11px] font-medium ${c.accent}`}>纠错与待确认冲突</div>
        {conflicts.length === 0 ? <div className={`rounded-xl border ${c.border} py-8 text-center text-xs ${c.muted}`}>暂无待确认冲突</div> : <div className="space-y-2">{conflicts.map(conflict => {
          const memory = memories.find(item => item.id === conflict.memoryId)
          return <article key={conflict.id} className={`rounded-xl border ${c.border} p-3`}>
            <div className={`text-[9px] ${c.muted}`}>{conflict.createdBy === 'star' ? '星星提出' : '小火提出'} · {conflict.createdAt.slice(0, 16).replace('T', ' ')}</div>
            {conflict.reason && <p className={`mt-2 text-[10px] ${c.muted}`}>原因：{conflict.reason}</p>}
            <div className="mt-2 grid gap-2 sm:grid-cols-2"><div className={`rounded-lg ${c.surface} p-2`}><div className={`text-[9px] ${c.muted}`}>登记时的正式版本</div><p className="mt-1 text-[10px] leading-4">{conflict.currentSummary}</p></div><div className={`rounded-lg ${c.accentBg} p-2`}><div className={`text-[9px] ${c.accent}`}>建议修正版</div><p className="mt-1 text-[10px] leading-4">{conflict.proposedSummary}</p></div></div>
            {memory && memory.summary !== conflict.currentSummary && <div className={`mt-2 text-[9px] ${c.muted}`}>当前正文后来已变为：{memory.summary}</div>}
            <div className="mt-3 flex flex-wrap gap-2"><button disabled={busyId === `conflict-${conflict.id}`} onClick={() => resolveConflict(conflict, 'keep_current')} className={`rounded-lg px-2 py-1 text-[9px] ${c.surface} ${c.muted} disabled:opacity-40`}>保留正式版本</button><button disabled={busyId === `conflict-${conflict.id}` || memory?.lockOwner === 'star'} onClick={() => resolveConflict(conflict, 'use_proposal')} className={`rounded-lg px-2 py-1 text-[9px] ${c.accentBg} ${c.accent} disabled:opacity-40`}>{memory?.lockOwner === 'star' ? '星星锁定' : '采用修正版'}</button>{memory && <button disabled={memory.lockOwner === 'star'} onClick={() => { setDeletingMemoryId(memory.id); setSection('memories') }} className="rounded-lg bg-red-500/10 px-2 py-1 text-[9px] text-red-500 disabled:opacity-40">选择删除范围</button>}</div>
          </article>
        })}</div>}
      </div>}

      {section === 'system' && <div className={`rounded-xl border ${c.border} p-3`}>
        <div className={`text-[11px] font-medium ${c.accent}`}>系统状态</div>
        <div className={`mt-2 grid grid-cols-2 gap-2 text-[10px] ${c.muted}`}><div>数据库版本：{status?.version || '—'}</div><div>记忆家族：{status?.families || 0}</div><div>等星星审核：{status?.pendingStar || 0}</div><div>候选总数：{status?.candidates || 0}</div><div>待确认冲突：{status?.conflicts || 0}</div></div>
        <div className={`mt-2 text-[10px] ${c.muted}`}>新库仍独立运行，旧 Ombre 未停用，本页不会自动迁移旧数据。</div>
      </div>}

      {section === 'system' && <div className={`rounded-xl border ${c.border} p-3`}>
        <div className={`text-[11px] font-medium ${c.accent}`}>导出与备份</div>
        <p className={`mt-2 text-[10px] leading-4 ${c.muted}`}>SQLite 是可恢复的完整机器备份；Markdown 是方便阅读的活跃记忆档案。下载不会修改记忆库。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <a download href="/api/star-memory?view=export&format=sqlite" className={`rounded-lg px-3 py-1.5 text-[10px] font-medium ${c.accentBg} ${c.accent}`}>下载完整 SQLite 备份</a>
          <a download href="/api/star-memory?view=export&format=markdown" className={`rounded-lg px-3 py-1.5 text-[10px] ${c.surface} ${c.muted}`}>下载整库阅读版</a>
        </div>
        <div className="mt-3 flex gap-2">
          <select aria-label="选择导出的记忆家族" value={exportFamilyId} onChange={event => setExportFamilyId(event.target.value)} className={`min-w-0 flex-1 rounded-lg border ${c.border} ${c.surface} px-2 py-1.5 text-[10px]`}>
            <option value="">选择一个家族及其子家族…</option>
            {families.map(family => <option key={family.id} value={family.id}>{family.name}</option>)}
          </select>
          {exportFamilyId && <a download href={`/api/star-memory?view=export&format=markdown&familyId=${encodeURIComponent(exportFamilyId)}`} className={`rounded-lg px-3 py-1.5 text-[10px] ${c.surface} ${c.muted}`}>下载所选家族</a>}
        </div>
      </div>}

      {section === 'system' && memoryTrash.length > 0 && <div>
        <div className={`mb-2 text-[11px] font-medium ${c.accent}`}>正式记忆回收区</div>
        <div className="space-y-2">{memoryTrash.map(item => <div key={item.id} className={`flex items-center justify-between gap-3 rounded-xl border ${c.border} p-3`}><div><div className="text-xs">{item.summary}</div><div className={`mt-1 text-[9px] ${c.muted}`}>24 小时后清除 · {item.purgeAfter.slice(0, 16).replace('T', ' ')}</div></div><button disabled={busyId === item.id} onClick={() => restoreMemory(item.id)} className={`rounded-lg px-3 py-1.5 text-[10px] ${c.accentBg} ${c.accent} disabled:opacity-40`}>恢复</button></div>)}</div>
      </div>}

      {section === 'families' && <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className={`text-[11px] font-medium ${c.accent}`}>记忆家族</div>
          <button onClick={() => setShowFamilyForm(value => !value)} className={`rounded-lg px-3 py-1.5 text-[10px] ${c.accentBg} ${c.accent}`}>{showFamilyForm ? '取消' : '新建家族'}</button>
        </div>
        {showFamilyForm && <form onSubmit={event => { event.preventDefault(); createFamily() }} className={`mb-3 space-y-2 rounded-xl border ${c.border} p-3`}>
          <label className={`block text-[10px] ${c.muted}`}>家族名称
            <input required maxLength={120} value={familyDraft.name} onChange={event => setFamilyDraft(current => ({ ...current, name: event.target.value }))} className={`mt-1 w-full rounded-lg border ${c.border} ${c.surface} px-3 py-2 text-xs`} placeholder="例如：西班牙生活" />
          </label>
          <label className={`block text-[10px] ${c.muted}`}>短摘要（可选）
            <textarea maxLength={2000} value={familyDraft.summary} onChange={event => setFamilyDraft(current => ({ ...current, summary: event.target.value }))} className={`mt-1 min-h-16 w-full rounded-lg border ${c.border} ${c.surface} px-3 py-2 text-xs`} />
          </label>
          <label className={`block text-[10px] ${c.muted}`}>上级家族（可选，最多三层）
            <select value={familyDraft.parentId} onChange={event => setFamilyDraft(current => ({ ...current, parentId: event.target.value }))} className={`mt-1 w-full rounded-lg border ${c.border} ${c.surface} px-2 py-2 text-xs`}><option value="">作为顶层家族</option>{families.map(family => <option key={family.id} value={family.id}>{family.name}</option>)}</select>
          </label>
          <button disabled={busyId === 'new-family'} className={`rounded-lg px-3 py-1.5 text-[10px] font-medium ${c.accentBg} ${c.accent} disabled:opacity-40`}>创建家族</button>
        </form>}
        <div className="space-y-2">
          {familyTreeRows.map(({ family, depth }) => {
            const detail = familyDetails[family.id]
            const selected = splitSelections[family.id] || []
            const hasProtectedMembers = detail?.memories.some(memory => memory.lockOwner === 'star')
            return <div key={family.id} style={{ marginLeft: `${Math.min(depth, 2) * 16}px` }} className={`rounded-xl border ${c.border} p-3`}>
              <div className="flex items-center justify-between gap-2"><span className="text-xs">{depth > 0 ? '↳ ' : ''}{family.name}{family.lockOwner ? ` · 🔒${family.lockOwner === 'star' ? '星星' : '小火'}` : ''}</span><span className={`text-[9px] ${c.muted}`}>第 {depth + 1} 层 · {family.memberCount} 条 · {family.status === 'active' ? '发展中' : family.status === 'paused' ? '搁置' : family.status === 'ended' ? '已结束' : '已归档'}</span></div>
              {family.summary && <p className={`mt-1 line-clamp-3 text-[10px] leading-4 ${c.muted}`}>{family.summary}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button disabled={busyId === `detail-${family.id}`} onClick={() => toggleFamilyDetails(family.id)} className={`rounded-lg px-2 py-1 text-[9px] ${c.accentBg} ${c.accent} disabled:opacity-40`}>{expandedFamilyId === family.id ? '收起成员' : '展开成员'}</button>
                <button disabled={busyId === family.id || family.lockOwner === 'star'} onClick={() => manageFamily(family, 'update_family')} className={`rounded-lg px-2 py-1 text-[9px] ${c.surface} ${c.muted} disabled:opacity-40`}>改摘要</button>
                <button disabled={busyId === family.id || family.lockOwner === 'star'} onClick={() => manageFamily(family, 'set_family_lock')} className={`rounded-lg px-2 py-1 text-[9px] ${c.surface} ${c.muted} disabled:opacity-40`}>{family.lockOwner === 'star' ? '星星锁定' : family.lockOwner ? '解锁' : '加锁'}</button>
                {!['ended', 'archived'].includes(family.status) && <button disabled={busyId === family.id || family.lockOwner === 'star'} onClick={() => manageFamily(family, 'end_family')} className={`rounded-lg px-2 py-1 text-[9px] ${c.surface} ${c.muted} disabled:opacity-40`}>结束并压缩</button>}
                <button disabled={busyId === family.id || family.lockOwner === 'star'} onClick={() => manageFamily(family, 'recycle_family')} className={`rounded-lg px-2 py-1 text-[9px] ${c.surface} ${c.muted} disabled:opacity-40`}>移入回收区</button>
              </div>
              {expandedFamilyId === family.id && <div className={`mt-3 border-t pt-3 ${c.border}`}>
                {!detail ? <div className={`py-3 text-center text-[10px] ${c.muted}`}>加载家族内容…</div> : <>
                  <div className="space-y-2">
                    {detail.memories.map(memory => {
                      const link = detail.memberships.find(item => item.memoryId === memory.id)
                      const blocked = family.lockOwner === 'star' || memory.lockOwner === 'star'
                      return <div key={memory.id} className={`rounded-lg ${c.surface} p-2`}>
                        <div className="flex items-start gap-2">
                          <input aria-label={`选择拆出${memory.summary}`} type="checkbox" disabled={blocked} checked={selected.includes(memory.id)} onChange={() => setSplitSelections(current => ({ ...current, [family.id]: selected.includes(memory.id) ? selected.filter(id => id !== memory.id) : [...selected, memory.id] }))} className="mt-1" />
                          <div className="min-w-0 flex-1"><div className="text-[10px] leading-4">{memory.summary}{memory.lockOwner === 'star' ? ' · 🔒星星' : ''}</div>{link?.reason && <div className={`mt-1 text-[9px] ${c.muted}`}>{link.reason}</div>}</div>
                          <select aria-label="家族成员角色" disabled={blocked || busyId === `member-${family.id}-${memory.id}`} value={link?.role || 'member'} onChange={event => updateFamilyMember(family.id, memory.id, event.target.value as StarFamilyRole)} className={`rounded border ${c.border} bg-transparent px-1 py-1 text-[9px] disabled:opacity-40`}><option value="key_event">关键节点</option><option value="key_fact">关键事实</option><option value="member">普通成员</option><option value="unresolved">未完事项</option></select>
                          <button aria-label="移出家族" disabled={blocked || busyId === `member-${family.id}-${memory.id}`} onClick={() => updateFamilyMember(family.id, memory.id)} className={`px-1 text-[10px] ${c.muted} disabled:opacity-30`}>×</button>
                        </div>
                      </div>
                    })}
                    {detail.memories.length === 0 && <div className={`py-3 text-center text-[10px] ${c.muted}`}>这个家族还没有正式记忆</div>}
                  </div>
                  <div className={`mt-3 space-y-2 rounded-lg border ${c.border} p-2`}>
                    <div className={`text-[9px] ${c.muted}`}>勾选成员可拆成新家族；合并会保留一份共享记忆正文。</div>
                    <button disabled={selected.length === 0 || family.lockOwner === 'star' || busyId === `split-${family.id}`} onClick={() => splitFamily(family)} className={`rounded-lg px-2 py-1 text-[9px] ${c.surface} ${c.muted} disabled:opacity-40`}>拆出所选（{selected.length}）</button>
                    <div className="flex gap-2"><select aria-label="选择合并目标家族" value={mergeTarget[family.id] || ''} onChange={event => setMergeTarget(current => ({ ...current, [family.id]: event.target.value }))} className={`min-w-0 flex-1 rounded-lg border ${c.border} ${c.surface} px-2 py-1.5 text-[9px]`}><option value="">合并到…</option>{families.filter(target => target.id !== family.id && target.lockOwner !== 'star').map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</select><button disabled={!mergeTarget[family.id] || family.lockOwner === 'star' || hasProtectedMembers || busyId === `merge-${family.id}`} onClick={() => mergeFamily(family)} className={`rounded-lg px-2 py-1 text-[9px] ${c.surface} ${c.muted} disabled:opacity-40`}>合并</button></div>
                    {hasProtectedMembers && <div className={`text-[9px] ${c.muted}`}>包含星星锁定记忆，只有星星能移动这些归属。</div>}
                  </div>
                </>}
              </div>}
            </div>
          })}
          {families.length === 0 && <div className={`rounded-xl border ${c.border} py-8 text-center text-xs ${c.muted}`}>暂无家族</div>}
        </div>
      </div>}

      {section === 'system' && familyTrash.length > 0 && <div>
        <div className={`mb-2 text-[11px] font-medium ${c.accent}`}>家族回收区</div>
        <div className="space-y-2">{familyTrash.map(item => <div key={item.id} className={`flex items-center justify-between gap-3 rounded-xl border ${c.border} p-3`}><div><div className="text-xs">{item.name}</div><div className={`mt-1 text-[9px] ${c.muted}`}>24 小时后清除 · {item.purgeAfter.slice(0, 16).replace('T', ' ')}</div></div><button disabled={busyId === item.id} onClick={() => restoreFamily(item.id)} className={`rounded-lg px-3 py-1.5 text-[10px] ${c.accentBg} ${c.accent} disabled:opacity-40`}>恢复</button></div>)}</div>
      </div>}

      {section === 'system' && memoryTrash.length === 0 && familyTrash.length === 0 && <div className={`rounded-xl border ${c.border} py-8 text-center text-xs ${c.muted}`}>回收区为空</div>}

      <PaperActionDialog
        open={!!starDialog}
        title={starDialog?.kind === 'import_ombre' ? '导入旧 Ombre 记忆？'
          : starDialog?.kind === 'flag_conflict' ? '登记纠错'
            : starDialog?.kind === 'merge_family' ? '合并家族？'
              : starDialog?.kind === 'split_family' ? '拆出新家族'
                : starDialog?.action === 'update_family' ? '更新家族摘要'
                  : starDialog?.action === 'end_family' ? '结束并压缩家族？' : '移入回收区？'}
        confirmLabel={starDialog?.kind === 'import_ombre' ? '放入待审核' : starDialog?.kind === 'flag_conflict' ? '登记' : starDialog?.kind === 'split_family' ? '拆出' : starDialog?.kind === 'manage_family' && starDialog.action === 'update_family' ? '保存' : '确认'}
        danger={starDialog?.kind === 'merge_family' || (starDialog?.kind === 'manage_family' && starDialog.action !== 'update_family')}
        busy={!!busyId}
        onClose={() => setStarDialog(null)}
        onConfirm={confirmStarDialog}
      >
        {starDialog?.kind === 'import_ombre' && <p className="text-sm leading-6 opacity-65">剩余 {ombreImport?.remaining || 0} 个旧桶会进入小火待审核区。旧桶不会被修改或删除。</p>}
        {starDialog?.kind === 'flag_conflict' && <div className="space-y-3">
          <label className="block text-xs">建议的准确版本<textarea autoFocus value={starDialog.proposedSummary} onChange={event => setStarDialog(current => current?.kind === 'flag_conflict' ? { ...current, proposedSummary: event.target.value } : current)} className="mt-1 min-h-20 w-full rounded-xl border border-current/15 bg-transparent p-3" /></label>
          <label className="block text-xs">原因（可选）<textarea value={starDialog.reason} onChange={event => setStarDialog(current => current?.kind === 'flag_conflict' ? { ...current, reason: event.target.value } : current)} className="mt-1 min-h-16 w-full rounded-xl border border-current/15 bg-transparent p-3" /></label>
        </div>}
        {starDialog?.kind === 'merge_family' && <p className="text-sm leading-6 opacity-65">“{starDialog.family.name}”会合并进“{families.find(item => item.id === starDialog.targetId)?.name || '目标家族'}”，原家族进入 24 小时回收区。</p>}
        {starDialog?.kind === 'split_family' && <label className="block text-xs">新家族名称<input autoFocus value={starDialog.name} onChange={event => setStarDialog(current => current?.kind === 'split_family' ? { ...current, name: event.target.value } : current)} className="mt-1 w-full rounded-xl border border-current/15 bg-transparent p-3" /></label>}
        {starDialog?.kind === 'manage_family' && starDialog.action === 'update_family' && <label className="block text-xs">家族短摘要<textarea autoFocus value={starDialog.summary} onChange={event => setStarDialog(current => current?.kind === 'manage_family' ? { ...current, summary: event.target.value } : current)} className="mt-1 min-h-24 w-full rounded-xl border border-current/15 bg-transparent p-3" /></label>}
        {starDialog?.kind === 'manage_family' && starDialog.action === 'end_family' && <p className="text-sm leading-6 opacity-65">结束后会移除普通成员归属，只保留关键节点、关键事实与未完事项。</p>}
        {starDialog?.kind === 'manage_family' && starDialog.action === 'recycle_family' && <p className="text-sm leading-6 opacity-65">家族会进入 24 小时回收区；共享记忆正文不会删除。</p>}
      </PaperActionDialog>
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
    topic: isNight ? '#CFA7A2' : '#E8A0BF',
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
      ctx.fillStyle = isNight ? '#AEB8BF' : '#888'
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

    ctx.fillStyle = isNight ? '#111B25' : '#FDFCF0'
    ctx.fillRect(0, 0, W, H)

    edges.forEach((e: any) => {
      const a = pos[e.source], b = pos[e.target]
      if (!a || !b) return
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y)
      ctx.strokeStyle = isNight ? `rgba(212,165,116,${(e.weight || 0.5) * 0.35})` : `rgba(47,79,79,${(e.weight || 0.5) * 0.35})`
      ctx.lineWidth = Math.max(0.5, (e.weight || 0.5) * 2); ctx.stroke()
    })

    const nodeColor = isNight ? '#CFA7A2' : '#2F4F4F'
    nodes.forEach((n: any) => {
      const p = pos[n.id]; if (!p) return
      const r = Math.max(4, Math.min(14, (n.importance || 5) * 1.4))
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2)
      ctx.fillStyle = nodeColor + '15'; ctx.fill()
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.fillStyle = nodeColor; ctx.fill()

      const name = (n.name || '').length > 10 ? n.name.slice(0, 10) + '…' : n.name
      ctx.fillStyle = isNight ? '#F2EEE7' : '#3A3530'
      ctx.font = '10px sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(name, p.x, p.y + r + 12)
    })
  }

  return (
    <div>
      <div className="flex gap-3 mb-2 text-[10px]">
        <div className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full" style={{ background: isNight ? '#CFA7A2' : '#2F4F4F' }} /> 节点</div>
        <div className="flex items-center gap-1"><span className="w-6 h-px" style={{ background: isNight ? '#CFA7A2' : '#2F4F4F' }} /> 共享标签</div>
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
                        background: isNight ? '#CFA7A2' : '#E8A0BF',
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
    accent: isNight ? 'text-night-amber' : 'text-[#9c6e69]',
    accentBg: isNight ? 'bg-night-amber/15' : 'bg-[#DBB9B3]/20',
    card: isNight ? 'bg-night-card' : 'chat-dialog-card',
    surface: isNight ? 'bg-night-surface' : 'bg-[#DBB9B3]/10',
    muted: isNight ? 'text-night-muted' : 'text-day-muted',
    border: isNight ? 'border-night-border' : 'border-[#a73a32]/15',
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
