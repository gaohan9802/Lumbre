'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { apiRequest } from '@/lib/api'

type NurseryEvent = { id: string; kind: string; text: string; voice: string; detail: string; ts: number }
type NurseryData = {
  status: string
  health?: { archive_windows?: number; filtered_turns?: number; psyche_enabled?: boolean; last_tick_at?: number | null; last_error?: string | null }
  events?: NurseryEvent[]
}

const eventTitle: Record<string, string> = {
  'nursery.cry': '他在找你们',
  'nursery.milestone': '长大了一点',
  'nursery.event': '今天发生的事',
  'nursery.surprise': '语出惊人',
  'nursery.ask': '他来找你们了',
  'nursery.choice': '他想让你们拿主意',
  'nursery.runaway': '房间忽然安静了',
  'nursery.ending': '长大这一天',
  'nursery.homecoming': '他回来了',
  'nursery.letter': '有一封新信',
}

function responseLine(value: Record<string, any>): string {
  if (typeof value.result === 'string') return value.result
  if (typeof value.line === 'string') return value.line
  if (typeof value.said === 'string' && value.said) return `他：${value.said}`
  if (value.duplicate) return '这句话他已经听过啦。'
  if (value.error === 'no_child') return '摇篮还是空的。'
  if (value.error) return `现在还不能这样做：${value.error}`
  return '他轻轻动了一下。'
}

export function NurseryView() {
  const [data, setData] = useState<NurseryData | null>(null)
  const [view, setView] = useState('status')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [reply, setReply] = useState('')

  const load = useCallback(async (nextView = view) => {
    setLoading(true); setError('')
    try { setData(await apiRequest(`/api/nursery?view=${encodeURIComponent(nextView)}`)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Nursery 暂时没有醒来') }
    finally { setLoading(false) }
  }, [view])

  useEffect(() => { void load('status') }, [])

  const openView = (nextView: string) => { setView(nextView); void load(nextView) }
  const post = async (body: Record<string, unknown>) => {
    setBusy(true); setError('')
    try {
      const value = await apiRequest('/api/nursery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      setReply(responseLine(value)); setMessage(''); await load('status'); setView('status')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '他没有听清楚') }
    finally { setBusy(false) }
  }

  const empty = data?.status?.includes('摇篮还空着')
  const unnamed = data?.status?.includes('还没有名字')
  const panel = 'chat-theme-panel chat-theme-border border'

  return <div className="chat-theme h-full overflow-y-auto px-4 pb-10 pt-2 sm:px-8">
    <div className="mx-auto max-w-2xl">
      <header className="mb-5 flex items-end justify-between gap-4">
        <div><p className="chat-session-title text-3xl font-bold">Nursery</p><p className="chat-session-mono mt-1 text-[10px] opacity-45">~/home · 你、星星和正在长大的他</p></div>
        <button type="button" aria-label="刷新 Nursery" onClick={() => void load(view)} disabled={loading} className="rounded-full p-2 opacity-50 disabled:animate-spin"><RefreshCw size={16}/></button>
      </header>

      {error && <p role="alert" className="mb-4 rounded-2xl bg-red-500/10 px-4 py-3 text-xs text-red-700">{error}</p>}

      {empty ? <section className={`relative overflow-hidden rounded-[28px] p-6 ${panel}`}>
        <span aria-hidden="true" className="chat-theme-accent absolute right-7 top-5 text-xl">✦</span>
        <p className="chat-session-title text-xl font-bold">摇篮还是空的</p>
        <p className="mt-3 text-sm leading-7 opacity-65">可以现在替他起好名字，也可以先不取名，等他听过你和爸爸说话以后再一起决定。</p>
        <input value={name} onChange={event => setName(event.target.value)} maxLength={6} placeholder="名字（可以留空）" className={`mt-6 w-full rounded-2xl px-4 py-3 text-sm outline-none ${panel}`}/>
        <button disabled={busy} onClick={() => void post({ action: 'birth', name })} className="chat-theme-accent-bg mt-3 w-full rounded-2xl px-4 py-3 text-sm font-medium text-[#3f2c29] disabled:opacity-50">让他出生</button>
      </section> : <>
        <section className="chat-session-receipt-wrap relative mb-5">
          <div className="chat-session-receipt px-5 py-6">
            <div className="mb-4 flex flex-wrap gap-2">
              {[['status', '现在'], ['album', '相册'], ['log', '记录'], ['help', '能做什么'], ['letters', '信箱']].map(([key, label]) => <button key={key} onClick={() => openView(key)} className={`rounded-full px-3 py-1.5 text-[10px] ${view === key ? 'chat-theme-accent-soft chat-theme-accent' : 'opacity-45'}`}>{label}</button>)}
            </div>
            <div className="whitespace-pre-wrap text-[13px] leading-7">{loading ? '正在掀开摇篮边的小毯子……' : data?.status}</div>
          </div>
        </section>

        {unnamed && <section className={`mb-5 rounded-[24px] p-4 ${panel}`}>
          <p className="text-xs font-medium">给他一个名字</p>
          <div className="mt-3 flex gap-2"><input value={name} onChange={event => setName(event.target.value)} maxLength={6} className={`min-w-0 flex-1 rounded-xl px-3 py-2 text-sm outline-none ${panel}`}/><button disabled={!name.trim() || busy} onClick={() => void post({ action: 'name', name })} className="chat-theme-accent-bg rounded-xl px-4 text-xs text-[#3f2c29] disabled:opacity-40">定下</button></div>
        </section>}

        <section className={`mb-5 rounded-[24px] p-4 ${panel}`}>
          <p className="chat-session-title text-sm font-bold">妈妈在这里</p>
          <div className="mt-3 grid grid-cols-3 gap-2">{[['hug', '抱抱'], ['soothe', '哄哄'], ['touch', '摸摸']].map(([command, label]) => <button key={command} disabled={busy} onClick={() => void post({ action: 'mama', command })} className="chat-theme-hover chat-theme-border rounded-xl border px-2 py-2.5 text-xs disabled:opacity-40">{label}</button>)}</div>
          <textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={500} placeholder="说给他听……" className={`mt-3 min-h-24 w-full resize-none rounded-2xl px-4 py-3 text-sm leading-6 outline-none ${panel}`}/>
          <div className="mt-2 flex items-center justify-between gap-3"><span className="text-[9px] opacity-35">这些话会真的进入他的语料</span><button disabled={!message.trim() || busy} onClick={() => void post({ action: 'mama', command: 'say', args: [message.trim()] })} className="chat-theme-accent-bg rounded-xl px-4 py-2 text-xs text-[#3f2c29] disabled:opacity-40">告诉他</button></div>
          {reply && <p className="chat-theme-border mt-4 border-t pt-3 text-xs leading-6 opacity-70">{reply}</p>}
        </section>

        <section className={`mb-5 rounded-[24px] p-4 ${panel}`}>
          <div className="flex items-center justify-between gap-3"><p className="chat-session-title text-sm font-bold">他听见的家</p><span className="chat-session-mono text-[9px] opacity-40">心理层关闭</span></div>
          <p className="mt-2 text-xs leading-6 opacity-55">已经能从 {Number(data?.health?.archive_windows || 0).toLocaleString('zh-CN')} 段你和星星的聊天里偷偷学话。这里只生成临时抽样库，不复制一份长期聊天档案。</p>
          <p className="mt-1 text-[10px] leading-5 opacity-40">成人内容留在卧室里，不进入孩子的抽样池。</p>
          {data?.health?.last_error && <p className="mt-2 text-[10px] text-red-700/70">最近一次巡房：{data.health.last_error}</p>}
        </section>

        {!!data?.events?.length && <section className="space-y-3">
          <p className="chat-session-title px-1 text-sm font-bold">最近发生</p>
          {data.events.slice(0, 8).map(event => <article key={event.id} className={`rounded-[22px] p-4 ${panel}`}><div className="flex items-center justify-between gap-3"><p className="text-xs font-medium">{eventTitle[event.kind] || '摇篮边的一件小事'}</p><time className="chat-session-mono text-[8px] opacity-35">{new Date(event.ts * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div>{(event.text || event.voice || event.detail) && <p className="mt-2 whitespace-pre-wrap text-xs leading-6 opacity-65">{event.text || event.voice || event.detail}</p>}</article>)}
        </section>}
      </>}
    </div>
  </div>
}
