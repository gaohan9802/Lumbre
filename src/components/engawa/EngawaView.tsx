'use client'

import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { Archive, BookOpen, Bookmark, RefreshCw, Sparkles, Telescope, X } from 'lucide-react'
import { apiRequest } from '@/lib/api'
import { madridDateKey } from '@/lib/madrid-time'
import { useTheme } from '@/lib/theme'

type Capture = { captured_at: string; input: Record<string, unknown>; result: Record<string, any> }
type Day = Record<string, Capture>
type LeopardLine = { text: string; updated_at: string }

const DAILY = ['daily_poem', 'daily_art', 'sky_tonight', 'apod', 'on_this_day', 'arxiv_new', 'hobby_corner'] as const
const TOOLS = [
  ['web_read', '读公开网页'], ['rss_read', '读 RSS'], ['shelf', '窗台书架'], ['shelf_add', '收藏来源'], ['shelf_suggest', '推荐来源'], ['shelf_remove', '移除来源'],
  ['sky_tonight', '今晚的天空'], ['apod', 'NASA 每日天文图'], ['daily_art', '今日一画'], ['arxiv_new', '最新论文'], ['daily_poem', '今日诗词'], ['on_this_day', '历史上的今天'],
  ['hobby_corner', '爱好角落'], ['hobby_add', '添加爱好'], ['hobby_remove', '移除爱好'],
  ['write_windowsill_line', '写豹子一句'],
] as const
const TITLES: Record<string, string> = { daily_poem: '今日诗词', daily_art: '今日一画', sky_tonight: '今晚的天空', apod: '宇宙今日份', on_this_day: '历史上的今天', arxiv_new: '新论文', hobby_corner: '爱好角落' }

const MOON: Record<string, string> = {
  'New Moon': '新月', 'Waxing Crescent': '娥眉月', 'First Quarter': '上弦月', 'Waxing Gibbous': '盈凸月',
  'Full Moon': '满月', 'Waning Gibbous': '亏凸月', 'Last Quarter': '下弦月', 'Waning Crescent': '残月',
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r); ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r); ctx.closePath()
}

function cover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const sw = width / scale; const sh = height / scale
  ctx.drawImage(image, (image.naturalWidth - sw) / 2, (image.naturalHeight - sh) / 2, sw, sh, x, y, width, height)
}

function wrapped(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, lineHeight: number, maxLines: number) {
  let line = ''; let row = 0
  for (const char of Array.from(text)) {
    if (ctx.measureText(line + char).width > width && line) {
      ctx.fillText(line, x, y + row * lineHeight); row += 1; line = char
      if (row >= maxLines) return
    } else line += char
  }
  if (line && row < maxLines) ctx.fillText(line, x, y + row * lineHeight)
}

async function makeBookmark(date: string, day: Day, line: LeopardLine | null): Promise<string> {
  const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 1500
  const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('浏览器不能生成书签')
  const coffee = '#4b342f'; const cream = '#f5efe3'; const rule = '#cbbdb0'
  rounded(ctx, 0, 0, 900, 1500, 52); ctx.clip(); ctx.fillStyle = cream; ctx.fillRect(0, 0, 900, 1500)
  ctx.strokeStyle = 'rgba(124,94,82,.13)'; ctx.lineWidth = 1
  for (let x = 0; x <= 900; x += 30) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 1500); ctx.stroke() }
  for (let y = 0; y <= 1500; y += 30) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(900, y); ctx.stroke() }

  const [leopard, otter, art] = await Promise.all([
    loadImage('/engawa/leopard-head.png'), loadImage('/engawa/otter-corner.png'),
    day.daily_art?.result.image_url ? loadImage(`/api/engawa/art?date=${encodeURIComponent(date)}`) : Promise.resolve(null),
  ])
  if (leopard) ctx.drawImage(leopard, 376, 28, 148, 133)
  ctx.fillStyle = coffee; ctx.textAlign = 'center'; ctx.font = '600 30px ui-serif, serif'; ctx.fillText('豹子的窗台 · 每日书签', 450, 190)
  ctx.font = '20px ui-sans-serif, sans-serif'; ctx.globalAlpha = .55; ctx.fillText(date.replaceAll('-', ' · '), 450, 226); ctx.globalAlpha = 1; ctx.textAlign = 'left'

  const sections = [[58, 264, 784, 500], [58, 790, 784, 188], [58, 1004, 784, 156], [58, 1186, 784, 218]] as const
  for (const [x, y, width, height] of sections) { rounded(ctx, x, y, width, height, 24); ctx.fillStyle = 'rgba(255,251,243,.68)'; ctx.fill(); ctx.strokeStyle = 'rgba(91,59,51,.16)'; ctx.stroke() }
  ctx.fillStyle = coffee; ctx.font = '600 22px ui-sans-serif, sans-serif'; ctx.fillText('今日画', 88, 307)
  if (art) { ctx.save(); rounded(ctx, 88, 330, 724, 402, 18); ctx.clip(); cover(ctx, art, 88, 330, 724, 402); ctx.restore() }

  ctx.font = '600 22px ui-sans-serif, sans-serif'; ctx.fillText('今日诗', 88, 836)
  ctx.font = '34px ui-serif, serif'; wrapped(ctx, String(day.daily_poem?.result.sentence || ''), 88, 898, 724, 48, 2)

  ctx.font = '600 22px ui-sans-serif, sans-serif'; ctx.fillText('今晚的天', 88, 1050)
  ctx.font = '32px ui-serif, serif'; const phase = String(day.sky_tonight?.result.moon_phase || '')
  ctx.fillText(phase ? `月相 · ${MOON[phase] || phase}` : '', 88, 1112)

  ctx.font = '600 22px ui-sans-serif, sans-serif'; ctx.fillText('豹子一句', 88, 1232)
  ctx.font = '31px ui-serif, serif'; wrapped(ctx, line?.text || '', 88, 1293, 590, 45, 2)
  if (otter) ctx.drawImage(otter, 676, 1280, 164, 119)
  ctx.strokeStyle = rule; ctx.globalAlpha = .6; ctx.beginPath(); ctx.moveTo(58, 1440); ctx.lineTo(842, 1440); ctx.stroke(); ctx.globalAlpha = 1
  ctx.textAlign = 'center'; ctx.font = '16px ui-sans-serif, sans-serif'; ctx.globalAlpha = .45; ctx.fillText('LEOPARD’S WINDOWSILL', 450, 1473)
  return canvas.toDataURL('image/png')
}

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
  const [line, setLine] = useState<LeopardLine | null>(null)
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [error, setError] = useState('')
  const [bookmarkOpen, setBookmarkOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [bookmarkImage, setBookmarkImage] = useState('')

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
      setDay(saved); setLine(data.line || null); setDates(data.dates || [])
      if (fillToday && nextDate === today) await Promise.allSettled(DAILY.filter(name => !saved[name]).map(name => run(name, name === 'on_this_day' ? { lang: 'en', limit: 5 } : name === 'arxiv_new' ? { category: 'cs.AI', limit: 4 } : name === 'hobby_corner' ? { per_topic: 2 } : {})))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '没有读到窗台日签') }
  }, [run, today])

  useEffect(() => { void openDate(today, true) }, [openDate, today])
  useEffect(() => {
    if (!bookmarkOpen) return
    let active = true; setBookmarkImage('')
    void makeBookmark(date, day, line).then(image => { if (active) setBookmarkImage(image) }).catch(() => { if (active) setError('每日书签暂时没有生成成功') })
    return () => { active = false }
  }, [bookmarkOpen, date, day, line])

  return <main className={`h-full overflow-y-auto ${night ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
    <div className="mx-auto max-w-5xl px-4 pb-10 pt-2 sm:px-8">
      <header className="flex items-start justify-between gap-4 pb-5">
        <div><p className="text-[10px] tracking-[.28em] opacity-40">LEOPARD'S WINDOWSILL</p><h1 className="mt-1 font-serif text-2xl">豹子的窗台</h1><p className="mt-2 text-xs opacity-45">星星从这里看看外面的世界。当天内容会自动收进日签，零点以后也不会消失。</p></div>
        <div className="mt-1 flex gap-2"><button type="button" aria-label="打开每日书签" onClick={() => setBookmarkOpen(true)} className="chat-theme-soft rounded-full p-2.5"><Bookmark size={16}/></button><button type="button" aria-label="刷新今日窗台" onClick={() => void Promise.allSettled(DAILY.map(name => run(name, name === 'on_this_day' ? { lang: 'en', limit: 5 } : name === 'arxiv_new' ? { category: 'cs.AI', limit: 4 } : name === 'hobby_corner' ? { per_topic: 2 } : {})))} disabled={loading.size > 0 || date !== today} className="chat-theme-soft rounded-full p-2.5 disabled:opacity-30"><RefreshCw size={16} className={loading.size ? 'animate-spin' : ''}/></button></div>
      </header>

      <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
        <button type="button" onClick={() => void openDate(today, true)} className={`shrink-0 rounded-full px-3 py-2 text-xs ${date === today ? 'chat-theme-accent-bg text-[#3f2c29]' : 'chat-theme-soft'}`}>今天</button>
        {dates.filter(item => item !== today).map(item => <button key={item} type="button" onClick={() => void openDate(item)} className={`shrink-0 rounded-full px-3 py-2 text-xs ${date === item ? 'chat-theme-accent-bg text-[#3f2c29]' : 'chat-theme-soft'}`}>{item.slice(5).replace('-', '.')}</button>)}
      </div>

      {date !== today && !Object.keys(day).length && <div className="chat-theme-panel chat-theme-border rounded-[24px] border px-5 py-12 text-center"><Archive className="mx-auto opacity-25" size={24}/><p className="mt-3 text-sm opacity-50">这一天还没有留下窗台日签。</p></div>}
      <section className="grid gap-3 md:grid-cols-2">{DAILY.map(name => <Card key={name} name={name} capture={day[name]} loading={loading.has(name)} retry={date === today ? () => void run(name, name === 'on_this_day' ? { lang: 'en', limit: 5 } : name === 'arxiv_new' ? { category: 'cs.AI', limit: 4 } : name === 'hobby_corner' ? { per_topic: 2 } : {}) : undefined}/>)}</section>
      {error && <p role="alert" className="mt-4 text-center text-xs text-red-500">{error}</p>}

      <details className="chat-theme-panel chat-theme-border mt-5 rounded-[24px] border p-4">
        <summary className="flex cursor-pointer list-none items-center gap-3"><div className="chat-theme-soft grid h-10 w-10 place-items-center rounded-2xl"><Telescope size={18}/></div><div className="min-w-0 flex-1"><p className="text-sm font-medium">窗台上的 16 件小工具</p><p className="mt-0.5 text-[10px] opacity-40">你可以看见，星星也可以自己调用、收藏和整理。</p></div><Sparkles size={14} className="opacity-35"/></summary>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">{TOOLS.map(([name, label]) => <div key={name} className="chat-theme-soft rounded-xl px-3 py-2"><p className="text-xs">{label}</p><p className="mt-0.5 truncate font-mono text-[8px] opacity-35">{name}</p></div>)}</div>
        <p className="mt-4 flex items-center gap-2 text-[10px] opacity-40"><BookOpen size={12}/>删除来源和爱好仍要经过正式确认，不会被前端按钮误触。</p>
      </details>
      {bookmarkOpen && <div className="fixed inset-0 z-[120] grid place-items-center bg-black/45 p-4 backdrop-blur-sm"><button type="button" aria-label="关闭每日书签" className="absolute inset-0" onClick={() => setBookmarkOpen(false)}/><section role="dialog" aria-modal="true" aria-label="豹子的窗台每日书签" className={`relative flex max-h-[94dvh] w-full max-w-md flex-col rounded-[28px] p-4 shadow-2xl ${night ? 'border border-night-border bg-night-surface' : 'chat-dialog'}`}><div className="mb-3 flex items-center justify-between"><div><p className="font-serif text-lg">每日书签</p><p className="mt-0.5 text-[10px] opacity-40">长按图片可以保存到本地</p></div><button type="button" aria-label="关闭" onClick={() => setBookmarkOpen(false)} className="rounded-full p-2 opacity-55"><X size={17}/></button></div><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{bookmarkImage ? <img src={bookmarkImage} alt={`${date} 豹子的窗台每日书签`} className="mx-auto w-full max-w-[340px] select-none rounded-[20px] shadow-lg" style={{ WebkitTouchCallout: 'default' } as CSSProperties}/> : <div className="mx-auto grid aspect-[3/5] w-full max-w-[340px] place-items-center rounded-[20px] bg-[#f5efe3] text-[#4b342f]/45"><RefreshCw className="animate-spin" size={18}/></div>}</div><button type="button" onClick={() => setDrawerOpen(value => !value)} className="chat-theme-soft mt-3 flex items-center justify-center gap-2 rounded-2xl py-2.5 text-xs"><Archive size={14}/>日签抽屉</button>{drawerOpen && <div className="mt-2 flex gap-2 overflow-x-auto pb-1">{Array.from(new Set([today, ...dates])).map(item => <button key={item} type="button" onClick={() => { void openDate(item); setDrawerOpen(false) }} className={`shrink-0 rounded-full px-3 py-2 text-xs ${date === item ? 'chat-theme-accent-bg text-[#3f2c29]' : 'chat-theme-soft'}`}>{item === today ? '今天' : item.slice(5).replace('-', '.')}</button>)}</div>}</section></div>}
    </div>
  </main>
}
