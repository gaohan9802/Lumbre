'use client'

import { useCallback, useEffect, useState } from 'react'
import { Archive, BookOpen, RefreshCw, Sparkles, Telescope } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { madridDateKey } from '@/lib/madrid-time'
import { useTheme } from '@/lib/theme'

type Capture = { captured_at: string; input: Record<string, unknown>; result: Record<string, any> }
type Day = Record<string, Capture>

const DAILY = ['daily_poem', 'daily_art', 'sky_tonight', 'apod', 'on_this_day', 'arxiv_new', 'hobby_corner'] as const
const TOOLS = [
  ['web_read', '读公开网页'], ['rss_read', '读 RSS'], ['shelf', '窗台书架'], ['shelf_add', '收藏来源'], ['shelf_suggest', '推荐来源'], ['shelf_remove', '移除来源'],
  ['sky_tonight', '今晚的天空'], ['apod', 'NASA 每日天文图'], ['daily_art', '今日一画'], ['arxiv_new', '最新论文'], ['daily_poem', '今日诗词'], ['on_this_day', '历史上的今天'],
  ['hobby_corner', '爱好角落'], ['hobby_add', '添加爱好'], ['hobby_remove', '移除爱好'],
] as const
const TITLES: Record<string, string> = { daily_poem: '今日诗词', daily_art: '今日一画', sky_tonight: '今晚的天空', apod: '宇宙今日份', on_this_day: '历史上的今天', arxiv_new: '新论文', hobby_corner: '爱好角落' }

function Card({ name, capture, loading, retry }: { name: string; capture?: Capture; loading: boolean; retry?: () => void }) {
  const value = capture?.result || {}
  const failed = value.ok === false
  const image = name === 'daily_art' ? value.image_url : name === 'apod' && value.media_type === 'image' ? value.url : ''
  return <article className="chat-theme-panel chat-theme-border overflow-hidden rounded-[22px] border">
    {image && <img src={image} alt={value.title || TITLES[name]} loading="lazy" referrerPolicy="no-referrer" className="aspect-[16/10] w-full object-cover"/>}
    <div className="p-4">
      <div className="flex items-center justify-between gap-3"><h2 className="font-serif text-base">{TITLES[name]}</h2>{retry && <button type="button" aria-label={`刷新${TITLES[name]}`} onClick={retry} disabled={loading} className="rounded-full p-1.5 opacity-40 disabled:opacity-20"><RefreshCw size={13} className={loading ? 'animate-spin' : ''}/></button>}</div>
      {!capture && !loading && <p className="mt-3 text-xs opacity-45">这一天没有留下这一张日签。</p>}
      {loading && !capture && <p className="mt-3 text-xs opacity-45">星星正在窗台上找找看…</p>}
      {failed && <p className="mt-3 text-xs leading-5 text-red-500/80">{value.note || '这次没有找到内容'}</p>}
      {!failed && name === 'daily_poem' && <><p className="mt-3 font-serif text-lg leading-8">{value.sentence}</p><p className="mt-2 text-[10px] opacity-45">{[value.dynasty, value.author, value.title].filter(Boolean).join(' · ')}</p>{value.full && <details className="mt-3 text-xs opacity-65"><summary className="cursor-pointer">展开全诗</summary><p className="mt-2 whitespace-pre-wrap leading-6">{value.full}</p></details>}</>}
      {!failed && name === 'daily_art' && <><p className="mt-3 text-sm font-medium">{value.title}</p><p className="mt-1 text-xs opacity-50">{[value.artist, value.date, value.medium].filter(Boolean).join(' · ')}</p></>}
      {!failed && name === 'apod' && <><p className="mt-3 text-sm font-medium">{value.title}</p><p className="mt-2 line-clamp-5 text-xs leading-5 opacity-60">{value.explanation}</p></>}
      {!failed && name === 'sky_tonight' && <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><span>月相 · {value.moon_phase}</span><span>亮度 · {value.moon_illumination}</span><span>日落 · {value.sunset}</span><span>月升 · {value.moonrise}</span><span className="col-span-2 opacity-60">21:00 · {(value.planets_2100 || []).join('、')}</span></div>}
      {!failed && name === 'on_this_day' && <div className="mt-3 space-y-2">{(value.events || []).slice(0, 5).map((item: any, index: number) => <p key={`${item.year}-${index}`} className="text-xs leading-5"><b>{item.year}</b> · {item.text}</p>)}</div>}
      {!failed && name === 'arxiv_new' && <div className="mt-3 space-y-3">{(value.papers || []).slice(0, 4).map((item: any) => <a key={item.link} href={item.link} target="_blank" rel="noreferrer" className="block text-xs leading-5"><b>{item.title}</b><span className="mt-0.5 block opacity-45">{item.authors}</span></a>)}</div>}
      {!failed && name === 'hobby_corner' && <div className="mt-3 space-y-3">{(value.hobbies || []).slice(0, 4).map((hobby: any) => <div key={hobby.topic}><p className="text-xs font-medium">{hobby.topic}</p>{(hobby.items || []).slice(0, 2).map((item: any) => <a key={item.url} href={item.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs opacity-60">{item.title}</a>)}</div>)}</div>}
      {capture && <p className="mt-3 text-[9px] opacity-30">{new Date(capture.captured_at).toLocaleString('zh-CN', { timeZone: 'Europe/Madrid', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 收进窗台</p>}
    </div>
  </article>
}

export function EngawaView() {
  const night = useTheme(state => state.theme === 'night')
  const today = madridDateKey()
  const [date, setDate] = useState(today)
  const [dates, setDates] = useState<string[]>([])
  const [day, setDay] = useState<Day>({})
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')

  const run = useCallback(async (name: string, input: Record<string, unknown> = {}) => {
    setLoading(current => new Set(current).add(name)); setError('')
    try {
      const data = await apiRequest('/api/engawa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool: name, input }) }, 45_000)
      const capture = { captured_at: data.captured_at, input, result: data.result } as Capture
      setDay(current => ({ ...current, [name]: capture }))
      setDates(current => current.includes(today) ? current : [today, ...current])
    } catch (cause) { setError(cause instanceof Error ? cause.message : '窗台暂时没有回应') }
    finally { setLoading(current => { const next = new Set(current); next.delete(name); return next }) }
  }, [today])

  const openDate = useCallback(async (nextDate: string, fillToday = false) => {
    setDate(nextDate); setError('')
    try {
      const data = await apiRequest(`/api/engawa?date=${encodeURIComponent(nextDate)}`)
      const saved = data.day || {}
      setDay(saved); setDates(data.dates || [])
      if (fillToday && nextDate === today) await Promise.allSettled(DAILY.filter(name => !saved[name]).map(name => run(name, name === 'on_this_day' ? { lang: 'en', limit: 5 } : name === 'arxiv_new' ? { category: 'cs.AI', limit: 4 } : name === 'hobby_corner' ? { per_topic: 2 } : {})))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '没有读到窗台日签') }
  }, [run, today])

  useEffect(() => { void openDate(today, true) }, [openDate, today])

  return <main className={`h-full overflow-y-auto ${night ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
    <div className="mx-auto max-w-5xl px-4 pb-10 pt-2 sm:px-8">
      <header className="flex items-start justify-between gap-4 pb-5">
        <div><p className="text-[10px] tracking-[.28em] opacity-40">LEOPARD'S WINDOWSILL</p><h1 className="mt-1 font-serif text-2xl">豹子的窗台</h1><p className="mt-2 text-xs opacity-45">星星从这里看看外面的世界。当天内容会自动收进日签，零点以后也不会消失。</p></div>
        <button type="button" aria-label="刷新今日窗台" onClick={() => void Promise.allSettled(DAILY.map(name => run(name, name === 'on_this_day' ? { lang: 'en', limit: 5 } : name === 'arxiv_new' ? { category: 'cs.AI', limit: 4 } : name === 'hobby_corner' ? { per_topic: 2 } : {})))} disabled={loading.size > 0 || date !== today} className="chat-theme-soft mt-1 rounded-full p-2.5 disabled:opacity-30"><RefreshCw size={16} className={loading.size ? 'animate-spin' : ''}/></button>
      </header>

      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
        <button type="button" onClick={() => void openDate(today, true)} className={`shrink-0 rounded-full px-3 py-2 text-xs ${date === today ? 'chat-theme-accent-bg text-[#3f2c29]' : 'chat-theme-soft'}`}>今天</button>
        {dates.filter(item => item !== today).map(item => <button key={item} type="button" onClick={() => void openDate(item)} className={`shrink-0 rounded-full px-3 py-2 text-xs ${date === item ? 'chat-theme-accent-bg text-[#3f2c29]' : 'chat-theme-soft'}`}>{item.slice(5).replace('-', '.')}</button>)}
      </div>

      {date !== today && !Object.keys(day).length && <div className="chat-theme-panel chat-theme-border rounded-[24px] border px-5 py-12 text-center"><Archive className="mx-auto opacity-25" size={24}/><p className="mt-3 text-sm opacity-50">这一天还没有留下窗台日签。</p></div>}
      <section className="grid gap-3 md:grid-cols-2">{DAILY.map(name => <Card key={name} name={name} capture={day[name]} loading={loading.has(name)} retry={date === today ? () => void run(name, name === 'on_this_day' ? { lang: 'en', limit: 5 } : name === 'arxiv_new' ? { category: 'cs.AI', limit: 4 } : name === 'hobby_corner' ? { per_topic: 2 } : {}) : undefined}/>)}</section>
      {error && <p role="alert" className="mt-4 text-center text-xs text-red-500">{error}</p>}

      <details className="chat-theme-panel chat-theme-border mt-5 rounded-[24px] border p-4">
        <summary className="flex cursor-pointer list-none items-center gap-3"><div className="chat-theme-soft grid h-10 w-10 place-items-center rounded-2xl"><Telescope size={18}/></div><div className="min-w-0 flex-1"><p className="text-sm font-medium">窗台上的 15 件小工具</p><p className="mt-0.5 text-[10px] opacity-40">你可以看见，星星也可以自己调用、收藏和整理。</p></div><Sparkles size={14} className="opacity-35"/></summary>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{TOOLS.map(([name, label]) => <div key={name} className="chat-theme-soft rounded-xl px-3 py-2"><p className="text-xs">{label}</p><p className="mt-0.5 truncate font-mono text-[8px] opacity-35">{name}</p></div>)}</div>
        <p className="mt-4 flex items-center gap-2 text-[10px] opacity-40"><BookOpen size={12}/>删除来源和爱好仍要经过正式确认，不会被前端按钮误触。</p>
      </details>
    </div>
  </main>
}
