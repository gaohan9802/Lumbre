'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, Dices, Edit3, Pin, Plus, RotateCcw, Send, Trash2, X } from 'lucide-react'
import { intimacyWheel as api } from '@/lib/api'
import { shareToChat } from '@/lib/share'
import { useApp } from '@/lib/store'

type Option = { id: string; text: string; enabled: boolean; created_by: 'fire' | 'star' }
type Pool = { id: string; name: string; emoji: string; options: Option[] }
type Result = { pool_id: string; pool: string; option_id: string; text: string }
type Recent = { id: string; results: Result[]; at: string }

export function IntimacyWheelModal({ open, night, onClose }: { open: boolean; night: boolean; onClose: () => void }) {
  const { currentUser } = useApp()
  const [pools, setPools] = useState<Pool[]>([])
  const [results, setResults] = useState<Result[]>([])
  const [recent, setRecent] = useState<Recent[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pinned, setPinned] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<'spin' | 'manage'>('spin')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [newText, setNewText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await api.get()
      setPools(data.pools || [])
      setRecent(data.recent || [])
      setSelected(current => current.size ? current : new Set((data.pools || []).map((pool: Pool) => pool.id)))
    } catch (cause: any) { setError(cause?.message || '转盘加载失败') }
  }, [])
  useEffect(() => { if (open) void load() }, [open, load])

  const chosen = useMemo(() => pools.filter(pool => selected.has(pool.id)), [pools, selected])
  const spin = async (only?: string[]) => {
    const explicit = !!only
    const poolIds = only || chosen.filter(pool => !pinned.has(pool.id)).map(pool => pool.id)
    if (!poolIds.length) return
    setBusy(true); setError('')
    try {
      const data = await api.act('spin', { actor: currentUser, pool_ids: poolIds })
      const fresh: Result[] = data.spin.results
      setResults(current => {
        const keep = current.filter(item => !poolIds.includes(item.pool_id) && (explicit || pinned.has(item.pool_id)))
        return chosen.flatMap(pool => [...keep, ...fresh].find(item => item.pool_id === pool.id) || [])
      })
    } catch (cause: any) { setError(cause?.message || '转动失败') }
    finally { setBusy(false) }
  }

  const act = async (action: string, data: Record<string, unknown>) => {
    setBusy(true); setError('')
    try { await api.act(action, { actor: currentUser, ...data }); await load(); return true }
    catch (cause: any) { setError(cause?.message || '操作失败'); return false }
    finally { setBusy(false) }
  }

  const share = () => {
    if (!results.length) return
    const body = results.map(item => `${item.pool}｜${item.text}`).join('\n')
    shareToChat({
      kind: 'intimacy-wheel', title: '今天怎么操', subtitle: '转盘结果', body,
      metadata: { results: results.map(({ pool_id, pool, option_id, text }) => ({ poolId: pool_id, pool, optionId: option_id, text })) },
    })
    onClose()
  }

  if (!open) return null
  return <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center" onClick={onClose}>
    <div role="dialog" aria-modal="true" aria-label="今天怎么操" onClick={event => event.stopPropagation()} className={`max-h-[92dvh] w-full overflow-hidden rounded-t-[30px] sm:w-[min(620px,calc(100vw-2rem))] sm:rounded-[30px] ${night ? 'bg-[#21151d] text-[#f7e9ef] shadow-2xl' : 'chat-dialog'}`}>
      <header className="flex items-center justify-between px-5 pb-3 pt-5"><div><h2 className="font-serif text-2xl">今天怎么操</h2><p className="text-xs opacity-50">把今晚交给一点运气</p></div><button aria-label="关闭" onClick={onClose} className="rounded-full p-2 hover:bg-black/5"><X size={19}/></button></header>
      <div className="mx-5 flex rounded-xl bg-black/5 p-1 text-xs"><button onClick={() => setTab('spin')} className={`flex-1 rounded-lg py-2 ${tab === 'spin' ? night ? 'bg-[#714052]' : 'chat-dialog-accent shadow-sm' : 'opacity-50'}`}>转盘</button><button onClick={() => setTab('manage')} className={`flex-1 rounded-lg py-2 ${tab === 'manage' ? night ? 'bg-[#714052]' : 'chat-dialog-accent shadow-sm' : 'opacity-50'}`}>元素池</button></div>

      <div className="max-h-[72dvh] overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4">
        {tab === 'spin' ? <>
          <div className="mb-4 flex flex-wrap gap-2">{pools.map(pool => <button key={pool.id} aria-pressed={selected.has(pool.id)} onClick={() => setSelected(current => { const next = new Set(current); next.has(pool.id) ? next.delete(pool.id) : next.add(pool.id); return next })} className={`rounded-full border px-3 py-1.5 text-xs transition ${selected.has(pool.id) ? night ? 'border-[#ad596e] bg-[#ad596e] text-white' : 'chat-dialog-accent' : 'border-current/15 opacity-45'}`}>{pool.emoji} {pool.name}</button>)}</div>

          <div className="grid min-h-52 grid-cols-2 gap-2 sm:grid-cols-3">{results.length ? results.map(item => <div key={item.pool_id} className={`relative rounded-2xl border p-3 text-left transition ${pinned.has(item.pool_id) ? night ? 'border-[#d59a72] bg-[#d59a72]/10' : 'chat-dialog-accent' : night ? 'border-current/10 bg-black/[.025]' : 'chat-dialog-card'}`}><span className="text-[10px] opacity-45">{item.pool}</span><p className="mt-1 pr-8 text-sm leading-5">{item.text}</p><div className="absolute right-2 top-2 flex gap-1"><button aria-label={`只重转${item.pool}`} onClick={() => { setPinned(current => { const next = new Set(current); next.delete(item.pool_id); return next }); void spin([item.pool_id]) }} className="p-1 opacity-40 hover:opacity-100"><RotateCcw size={12}/></button><button aria-label={`固定${item.pool}`} onClick={() => setPinned(current => { const next = new Set(current); next.has(item.pool_id) ? next.delete(item.pool_id) : next.add(item.pool_id); return next })} className={`p-1 ${pinned.has(item.pool_id) ? night ? 'text-[#d59a72]' : 'text-[#9c6e69]' : 'opacity-40'}`}><Pin size={12} fill={pinned.has(item.pool_id) ? 'currentColor' : 'none'}/></button></div></div>) : <div className="col-span-full flex flex-col items-center justify-center opacity-35"><Dices size={42} strokeWidth={1.2}/><p className="mt-3 text-sm">选好想玩的池，然后转</p></div>}</div>

          {error && <p className="mt-3 text-center text-xs text-red-400">{error}</p>}
          <div className="mt-5 grid grid-cols-[1fr_auto] gap-2"><button disabled={busy || !chosen.length} onClick={() => void spin()} className={`rounded-2xl py-3.5 text-lg font-semibold shadow-sm disabled:opacity-30 ${night ? 'bg-gradient-to-r from-[#873f58] to-[#bd6d78] text-white' : 'chat-dialog-accent'}`}>转</button><button disabled={!results.length} onClick={share} className="flex items-center gap-1 rounded-2xl border border-current/15 px-4 text-xs disabled:opacity-25"><Send size={15}/>发给星星</button></div>
          {!!pinned.size && <p className="mt-2 text-center text-[10px] opacity-45">点结果可以固定；再点「转」只重转没固定的池</p>}
          {!!recent.length && <details className="mt-4 text-xs opacity-50"><summary className="cursor-pointer list-none">最近转过 · {recent.length}</summary><div className="mt-2 max-h-32 space-y-2 overflow-y-auto">{recent.slice(0, 10).map(item => <button key={item.id} onClick={() => { setResults(item.results); setPinned(new Set()) }} className={`block w-full rounded-xl px-3 py-2 text-left ${night ? 'bg-black/5' : 'chat-dialog-card'}`}><span>{new Date(item.at).toLocaleString('zh-CN', { timeZone: 'Europe/Madrid', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span><br/><span className="opacity-70">{item.results.map(result => result.text).join(' · ')}</span></button>)}</div></details>}
        </> : <div className="space-y-2">
          {pools.map(pool => <section key={pool.id} className={`overflow-hidden rounded-2xl ${night ? 'border border-current/10' : 'chat-dialog-card'}`}>
            <button onClick={() => setExpanded(expanded === pool.id ? null : pool.id)} className="flex w-full items-center justify-between px-4 py-3 text-sm"><span>{pool.emoji} {pool.name} <small className="opacity-40">{pool.options.filter(option => option.enabled).length}/{pool.options.length}</small></span><ChevronDown size={15} className={`transition ${expanded === pool.id ? 'rotate-180' : ''}`}/></button>
            {expanded === pool.id && <div className="border-t border-current/10 px-3 py-3">
              <div className="mb-3 flex gap-2"><input value={newText} onChange={event => setNewText(event.target.value)} placeholder="加一个新元素" className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-sm outline-none ${night ? 'border-current/10 bg-transparent' : 'chat-dialog-field'}`}/><button disabled={!newText.trim() || busy} onClick={async () => { if (await act('add', { pool_id: pool.id, text: newText })) setNewText('') }} className={`rounded-xl px-3 ${night ? 'bg-[#ad596e] text-white' : 'chat-dialog-accent'}`}><Plus size={16}/></button></div>
              <div className="space-y-1">{pool.options.map(option => <div key={option.id} className={`flex items-center gap-2 rounded-xl px-2 py-2 text-sm ${option.enabled ? '' : 'opacity-35'}`}><button aria-label={option.enabled ? '停用' : '启用'} onClick={() => void act('edit', { pool_id: pool.id, option_id: option.id, enabled: !option.enabled })} className={`grid h-5 w-5 place-items-center rounded border ${option.enabled ? 'border-[#ad596e] bg-[#ad596e] text-white' : 'border-current/30'}`}>{option.enabled && <Check size={12}/>}</button><span className="min-w-0 flex-1">{option.text}</span><button aria-label="修改元素" onClick={async () => { const text = window.prompt('修改元素', option.text); if (text !== null) await act('edit', { pool_id: pool.id, option_id: option.id, text }) }} className="p-1 opacity-45"><Edit3 size={13}/></button><button aria-label="删除元素" onClick={async () => { if (window.confirm(`删除“${option.text}”？`)) await act('delete', { pool_id: pool.id, option_id: option.id }) }} className="p-1 text-red-400 opacity-65"><Trash2 size={13}/></button></div>)}</div>
            </div>}
          </section>)}
          {error && <p className="text-center text-xs text-red-400">{error}</p>}
        </div>}
      </div>
    </div>
  </div>
}
