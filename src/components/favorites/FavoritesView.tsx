'use client'

import { useCallback, useEffect, useState } from 'react'
import { Heart, Trash2 } from 'lucide-react'
import { apiRequest } from '@/lib/api'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiRequest(`/api/favorites${filter === 'all' ? '' : `?kind=${filter}`}`)
      setItems(Array.isArray(data) ? data : [])
    } catch (loadError: any) {
      setError(loadError?.message || '收藏夹加载失败')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  const remove = async (id: string) => {
    setError('')
    try {
      await apiRequest('/api/favorites', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', id, actor: currentUser }),
      })
      setItems(current => current.filter(item => item.id !== id))
    } catch (removeError: any) {
      setError(removeError?.message || '取消收藏失败')
    }
  }

  const border = night ? 'border-night-border' : 'border-[#a73a32]/15'
  const card = night ? 'bg-night-card/55' : 'bg-white/65'
  const muted = night ? 'text-night-muted' : 'text-[#80645d]/65'
  const accent = night ? 'text-night-amber' : 'text-[#9f302b]'

  return <div className={`h-full overflow-y-auto px-4 py-4 ${night ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
    <div className="mx-auto max-w-3xl space-y-3">
      <div className="flex items-center justify-between gap-3"><div><h2 className={`flex items-center gap-2 text-sm font-medium ${accent}`}><Heart size={15} fill="currentColor" />收藏夹</h2><p className={`mt-1 text-[10px] ${muted}`}>记忆、日记和星星的聊天回复，都收在这里。</p></div><span className={`text-[10px] ${muted}`}>{items.length} 条</span></div>
      <div className="flex gap-1">{([['all', '全部'], ['memory', '记忆'], ['diary', '日记'], ['chat', '聊天回复']] as const).map(([key, label]) => <button key={key} onClick={() => setFilter(key)} className={`rounded-lg px-2.5 py-1.5 text-[10px] ${filter === key ? (night ? 'bg-night-amber/20 text-night-amber' : 'bg-[#DBB9B3]/25 text-[#9f302b]') : `${card} ${muted}`}`}>{label}</button>)}</div>
      {error && <div className="rounded-xl bg-red-500/10 p-3 text-xs text-red-500">{error}</div>}
      {loading ? <div className={`py-16 text-center text-xs ${muted}`}>正在打开收藏夹…</div> : items.length === 0 ? <div className={`rounded-2xl border ${border} py-16 text-center`}><Heart className="mx-auto opacity-20" size={30}/><p className={`mt-3 text-xs ${muted}`}>还没有收藏</p></div> : <div className="space-y-2">{items.map(item => <article key={item.id} className={`rounded-2xl border ${border} ${card} p-4`}>
        <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className={`text-[9px] ${muted}`}>{LABELS[item.kind]} · {item.createdBy === 'star' ? '星星收藏' : '小火收藏'} · {item.createdAt.slice(0, 16).replace('T', ' ')}</div><h3 className="mt-1 text-sm font-medium leading-5">{item.title}</h3></div><button aria-label="取消收藏" title="取消收藏" onClick={() => remove(item.id)} className="p-1 text-red-400 opacity-55 hover:opacity-100"><Trash2 size={14}/></button></div>
        <div className={`mt-3 whitespace-pre-wrap break-words text-xs leading-6 ${muted}`}>{item.content}</div>
      </article>)}</div>}
    </div>
  </div>
}
