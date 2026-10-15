'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ExternalLink, Heart, Search, Share2, Trash2, Undo2 } from 'lucide-react'
import { MarkdownText } from '@/components/chat/MarkdownText'
import { apiRequest } from '@/lib/api'
import { formatMadridShort } from '@/lib/madrid-time'
import { shareToChat } from '@/lib/share'
import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'

interface FavoriteItem {
  id: string
  kind: 'memory' | 'diary' | 'chat'
  targetKey: string
  title: string
  content: string
  metadata: Record<string, unknown>
  createdBy: 'fire' | 'star'
  createdAt: string
}

const LABELS = { memory: '记忆', diary: '日记', chat: '聊天回复' }

export function FavoritesView() {
  const { theme } = useTheme()
  const { currentUser } = useApp()
  const night = theme === 'night'
  const [items, setItems] = useState<FavoriteItem[]>([])
  const [filter, setFilter] = useState<'all' | FavoriteItem['kind']>('all')
  const [query, setQuery] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [removedItem, setRemovedItem] = useState<FavoriteItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest('/api/favorites')
      setItems(Array.isArray(data) ? data : [])
    } catch (loadError: any) {
      setError(loadError?.message || '收藏夹加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const remove = async (item: FavoriteItem) => {
    setError('')
    try {
      await apiRequest('/api/favorites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', id: item.id, actor: currentUser }),
      })
      setItems(current => current.filter(value => value.id !== item.id))
      setExpandedId(current => current === item.id ? null : current)
      setRemovedItem(item)
    } catch (removeError: any) {
      setError(removeError?.message || '取消收藏失败')
    }
  }

  const undoRemove = async () => {
    if (!removedItem) return
    setError('')
    try {
      const result = await apiRequest('/api/favorites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', actor: currentUser, favorite: removedItem }),
      })
      if (!result?.favorited || !result.item) throw new Error('收藏恢复失败')
      setItems(current => [result.item, ...current])
      setRemovedItem(null)
    } catch (restoreError: any) {
      setError(restoreError?.message || '收藏恢复失败')
    }
  }

  const counts = useMemo(() => ({
    all: items.length,
    memory: items.filter(item => item.kind === 'memory').length,
    diary: items.filter(item => item.kind === 'diary').length,
    chat: items.filter(item => item.kind === 'chat').length,
  }), [items])
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-CN')
    return items.filter(item => (filter === 'all' || item.kind === filter)
      && (!needle || `${item.title}\n${item.content}`.toLocaleLowerCase('zh-CN').includes(needle)))
  }, [filter, items, query])

  const openSource = (item: FavoriteItem) => window.dispatchEvent(new CustomEvent('lumbre-open-favorite-source', { detail: item }))
  const share = (item: FavoriteItem) => shareToChat({
    kind: item.kind,
    title: `❤️ ${item.title}`,
    subtitle: `${LABELS[item.kind]} · ${item.createdBy === 'star' ? '星星收藏' : '小火收藏'} · 收藏时快照`,
    body: item.content,
    metadata: { ...item.metadata, favoriteId: item.id, targetKey: item.targetKey },
  })

  const border = night ? 'border-night-border' : 'border-[#a73a32]/15'
  const card = night ? 'bg-night-card/55' : 'bg-white/65'
  const muted = night ? 'text-night-muted' : 'text-[#80645d]/65'
  const accent = night ? 'text-night-amber' : 'text-[#9f302b]'

  return <div className={`h-full overflow-y-auto px-4 py-4 ${night ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center justify-between gap-3"><div><h2 className={`flex items-center gap-2 text-sm font-medium ${accent}`}><Heart size={15} fill="currentColor" />收藏夹</h2><p className={`mt-1 text-[10px] ${muted}`}>记忆、日记和星星的聊天回复，都收在这里。</p></div><span className={`text-[10px] ${muted}`}>{visibleItems.length} 条</span></div>
      <label className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${border} ${card}`}><Search size={13} className={muted}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索收藏…" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:opacity-35"/></label>
      <div className="flex gap-1 overflow-x-auto">{([['all', '全部'], ['memory', '记忆'], ['diary', '日记'], ['chat', '聊天回复']] as const).map(([key, label]) => <button key={key} onClick={() => { setFilter(key); setExpandedId(null) }} className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] ${filter === key ? (night ? 'bg-night-amber/20 text-night-amber' : 'bg-[#DBB9B3]/25 text-[#9f302b]') : `${card} ${muted}`}`}>{label} {counts[key]}</button>)}</div>
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-xs text-red-500">{error}</div>}
      {removedItem && <div className={`flex items-center justify-between rounded-xl border px-3 py-2 text-[10px] ${border} ${card}`}><span className={muted}>已取消收藏“{removedItem.title}”</span><button onClick={() => void undoRemove()} className={`flex items-center gap-1 ${accent}`}><Undo2 size={12}/>撤销</button></div>}
      {loading ? <div className={`py-16 text-center text-xs ${muted}`}>正在打开收藏夹…</div> : visibleItems.length === 0 ? <div className={`rounded-2xl border ${border} py-16 text-center`}><Heart className="mx-auto opacity-20" size={30}/><p className={`mt-3 text-xs ${muted}`}>{items.length ? '没有找到匹配的收藏' : '还没有收藏'}</p></div> : <div className="space-y-2">{visibleItems.map(item => {
        const expanded = expandedId === item.id
        const collapsible = item.content.length > 180 || item.content.split('\n').length > 4
        const contentId = `favorite-content-${item.id}`
        return <article key={item.id} className={`rounded-2xl border ${border} ${card} p-4`}>
          <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className={`text-[9px] ${muted}`}>{LABELS[item.kind]} · {item.createdBy === 'star' ? '星星收藏' : '小火收藏'} · {formatMadridShort(item.createdAt)}</div><h3 className="mt-1 text-sm font-medium leading-5">{item.title}</h3></div><div className="flex shrink-0 items-center"><button aria-label="查看原文" title="查看原文" onClick={() => openSource(item)} className="p-1 opacity-40 hover:opacity-80"><ExternalLink size={13}/></button><button aria-label="分享到 Chat" title="分享到 Chat" onClick={() => share(item)} className="p-1 opacity-40 hover:opacity-80"><Share2 size={13}/></button><button aria-label="取消收藏" title="取消收藏" onClick={() => void remove(item)} className="p-1 text-red-400 opacity-45 hover:opacity-100"><Trash2 size={13}/></button></div></div>
          <div id={contentId} className={`relative mt-3 text-xs leading-6 ${muted} ${collapsible && !expanded ? 'max-h-[7.5rem] overflow-hidden' : ''}`}>
            <MarkdownText content={item.content}/>
          </div>
          {collapsible && <button aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpandedId(expanded ? null : item.id)} className={`mt-2 flex w-full items-center justify-center gap-1 border-t pt-2 text-[10px] ${border} ${muted}`}>
            {expanded ? '收起' : '展开全文'}<ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`}/>
          </button>}
          {expanded && <div className={`mt-2 text-right text-[9px] ${muted}`}>收藏时快照</div>}
        </article>
      })}</div>}
    </div>
  </div>
}
