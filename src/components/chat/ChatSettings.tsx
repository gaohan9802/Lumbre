'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { useChatStore } from '@/lib/chatStore'
import { apiRequest } from '@/lib/api'

export type ChatSettingsPanel = 'menu' | 'star' | 'settings'
type RoomUnreadKey = 'coupons' | 'todo' | 'notes' | 'diary' | 'wishlist' | 'photos' | 'favorites' | 'media' | 'energy' | 'timeline' | 'poems' | 'stories' | 'research' | 'tesis'
interface Props {
  open: boolean
  onClose: () => void
  initialPanel?: ChatSettingsPanel
  onCoupons?: () => void
  onTodo?: () => void
  onTimeline?: () => void
  onTesis?: () => void
  onNotes?: () => void
  onDiary?: () => void
  onPhotos?: () => void
  onPoems?: () => void
  onStories?: () => void
  onResearch?: () => void
  onWishlist?: () => void
  onMedia?: () => void
  onEnergy?: () => void
  onFavorites?: () => void
}

export function ChatSettings(props: Props) {
  const { open, onClose, initialPanel = 'menu' } = props
  const { theme } = useTheme()
  const night = theme === 'night'
  const { settings, setSettings } = useChatStore()
  const [panel, setPanel] = useState<ChatSettingsPanel>(initialPanel)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [original, setOriginal] = useState('')
  const [error, setError] = useState('')
  const [roomUnread, setRoomUnread] = useState<Partial<Record<RoomUnreadKey, number>>>({})
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null)
  const discardRef = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const confirm = (action: () => void) => {
    if (editing && draft !== original) {
      const run = () => { setEditing(false); setError(''); action() }
      setPendingDiscard(() => run)
    } else { setEditing(false); setError(''); action() }
  }
  const close = () => { if (pendingDiscard) setPendingDiscard(null); else confirm(onClose) }
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!open) return
    setPanel(initialPanel); setEditing(false); setError('')
    const prior = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current() }
      if (event.key === 'Tab') {
        const scope = discardRef.current || dialog.current
        const nodes = scope?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select, [tabindex="0"]')
        if (!nodes?.length) return
        const first = nodes[0], last = nodes[nodes.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === scope)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === scope)) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; prior?.focus() }
  }, [open, initialPanel])
  useEffect(() => { if (open) dialog.current?.focus() }, [panel, open])
  useEffect(() => { if (pendingDiscard) discardRef.current?.querySelector('button')?.focus() }, [pendingDiscard])
  useEffect(() => {
    if (!open || panel !== 'menu') return
    let active = true
    const refresh = () => apiRequest('/api/room-unread').then(data => { if (active && data.unread) setRoomUnread(data.unread) }).catch(() => {})
    const clear = () => { void refresh() }
    void refresh()
    const timer = window.setInterval(refresh, 15_000)
    window.addEventListener('lumbre-guestbook-read', clear)
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('lumbre-guestbook-read', clear) }
  }, [open, panel])
  if (!open) return null
  const card = night ? 'bg-night-card' : 'chat-dialog-card'
  const button = `px-4 py-2.5 rounded-xl text-sm ${card}`
  const titles = { menu: '房间', star: 'SP', settings: '参数' }
  const navigate = (action?: () => void) => { onClose(); action?.() }
  const openRoom = (room: RoomUnreadKey, action?: () => void) => {
    setRoomUnread(current => ({ ...current, [room]: 0 }))
    void apiRequest('/api/room-unread', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room }) }).catch(() => {})
    navigate(action)
  }
  const row = (label: string, action: () => void, detail?: string, badge = 0) => <button key={label} onClick={action} className={`flex min-h-[50px] w-full items-center gap-2 px-3 py-2.5 text-left ${night ? 'rounded-xl bg-night-card/70' : 'border-b chat-dialog-line last:border-b-0'}`}>
    <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="text-sm leading-5">{label}</span>{detail && <span className="truncate text-[10px] leading-4 opacity-40">{detail}</span>}</span>{badge > 0 && <span aria-label={`${badge} 条未读`} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${night ? 'bg-night-amber text-night-bg' : 'bg-[#DBB9B3] text-white'}`}>{badge > 99 ? '99+' : `+${badge}`}</span>}<ChevronRight className="shrink-0 opacity-45" size={15}/>
  </button>
  const roomGroup = (title: string, items: React.ReactNode) => <section className="space-y-1.5"><h3 className="px-2 text-[10px] tracking-[.18em] opacity-35">{title}</h3><div className={night ? 'space-y-1.5' : 'overflow-hidden rounded-2xl border chat-dialog-line bg-white/20'}>{items}</div></section>
  const slider = (label: string, value: number, change: (v: number) => void, min = 0, max = 1, step = .05, display?: string) => <label className="block space-y-2 text-xs"><span className="flex justify-between gap-2"><span>{label}</span><span className="opacity-60">{display || `${Math.round(value * 100)}%`}</span></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => change(Number(e.target.value))} className="w-full"/></label>
  const toggle = (label: string, checked: boolean, action: () => void) => <button role="switch" aria-checked={checked} onClick={action} className="w-full flex items-center justify-between py-2 text-sm"><span>{label}</span><span className={`w-10 h-6 rounded-full p-0.5 ${checked ? (night ? 'bg-night-muted' : 'bg-[#DBB9B3]') : 'bg-gray-400/40'}`}><span className={`block w-5 h-5 bg-white rounded-full transition-transform ${checked ? 'translate-x-4' : ''}`}/></span></button>
  return <>
    <div className="fixed inset-0 z-[70] bg-black/30" onClick={close}/>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="chat-menu-title" className={`fixed ${panel !== 'menu' ? 'inset-x-4 mx-auto top-[8dvh] max-h-[84dvh] max-w-[640px] rounded-2xl' : 'right-0 top-0 bottom-0 w-[86vw] max-w-[340px]'} z-[71] flex flex-col overflow-hidden outline-none ${night ? 'bg-night-surface text-night-text shadow-2xl' : `chat-dialog ${panel === 'menu' ? 'border-y-0 border-r-0' : ''}`}`}>
      <div className={`relative z-10 flex items-center gap-3 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] border-b ${night ? 'border-current/10' : 'chat-dialog-line'}`}>
        {panel !== 'menu' && <button aria-label={initialPanel === 'menu' ? '返回房间' : '关闭'} onClick={() => initialPanel === 'menu' ? confirm(() => setPanel('menu')) : close()} className="p-2"><ChevronLeft size={20}/></button>}
        <h2 id="chat-menu-title" className="flex-1 font-medium">{titles[panel]}</h2>
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto p-5 ${panel === 'menu' ? 'space-y-5' : 'space-y-4'}`}>
        {panel === 'menu' && <>
          {roomGroup('一起生活', <>
            {row('券包', () => openRoom('coupons', props.onCoupons), '承诺与小特权', roomUnread.coupons)}
            {row('Todo', () => openRoom('todo', props.onTodo), '一起做的事', roomUnread.todo)}
            {row('小纸条', () => openRoom('notes', props.onNotes), '留言与告状簿', roomUnread.notes)}
            {row('日记', () => openRoom('diary', props.onDiary), '两个人的日记', roomUnread.diary)}
            {row('愿望清单', () => openRoom('wishlist', props.onWishlist), '想要与想做', roomUnread.wishlist)}
          </>)}
          {roomGroup('收藏与记录', <>
            {row('照片', () => openRoom('photos', props.onPhotos), '相册与旅行', roomUnread.photos)}
            {row('收藏夹', () => openRoom('favorites', props.onFavorites), '留下喜欢的片段', roomUnread.favorites)}
            {row('书影记录', () => openRoom('media', props.onMedia), '阅读、观影与共读', roomUnread.media)}
            {row('饮食运动', () => openRoom('energy', props.onEnergy), '吃喝、运动与目标', roomUnread.energy)}
            {row('Timeline', () => openRoom('timeline', props.onTimeline), '时间与日常记录', roomUnread.timeline)}
          </>)}
          {roomGroup('一起创作', <>
            {row('共诗', () => openRoom('poems', props.onPoems), '轮流写一首诗', roomUnread.poems)}
            {row('枕边集', () => openRoom('stories', props.onStories), '故事与长文', roomUnread.stories)}
            {row('星野手记', () => openRoom('research', props.onResearch), '研究与灵感', roomUnread.research)}
            {row('Tesis', () => openRoom('tesis', props.onTesis), '论文进度', roomUnread.tesis)}
          </>)}
        </>}
        {panel === 'star' && <>
          <div className="flex items-center justify-between gap-2"><span className="text-sm">System Prompt / 人设</span>{!editing && <button className={button} onClick={() => { setOriginal(settings.systemPrompt); setDraft(settings.systemPrompt); setEditing(true); setError('') }}>编辑</button>}</div>
          {editing ? <textarea autoFocus aria-label="编辑人设" value={draft} onChange={e => setDraft(e.target.value)} className={`w-full min-h-[50dvh] rounded-2xl p-4 text-sm leading-7 outline-none ${card}`}/> : <div className={`whitespace-pre-wrap break-words min-h-40 rounded-2xl p-4 text-sm leading-7 ${card}`}>{settings.systemPrompt || '尚未设置人设'}</div>}
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
          {editing && <div className="flex justify-end gap-3"><button className={button} onClick={() => confirm(() => setEditing(false))}>取消</button><button className={`${button} font-medium`} onClick={() => {
            if (useChatStore.getState().settings.systemPrompt !== original) { setError('人设已在别处修改，请取消后重新编辑。'); return }
            setSettings({ systemPrompt: draft }); setEditing(false); setError('')
          }}>保存</button></div>}
        </>}
        {panel === 'settings' && <>
          {slider('温度', settings.temperature, v => setSettings({ temperature: v }), 0, 2, .05, settings.temperature.toFixed(2))}
          {slider('思考预算', settings.thinkingBudget, v => setSettings({ thinkingBudget: v }), 0, 32000, 1000, `${settings.thinkingBudget} tok`)}
          {toggle('流式输出', settings.streamEnabled, () => setSettings({ streamEnabled: !settings.streamEnabled }))}
          {toggle('Prompt Caching', settings.promptCaching, () => setSettings({ promptCaching: !settings.promptCaching }))}
          {slider('上下文条数', settings.contextLength, v => setSettings({ contextLength: v }), 4, 200, 2, String(settings.contextLength))}
        </>}
      </div>
      {pendingDiscard && <div className="absolute inset-0 z-10 bg-black/40 flex items-center justify-center p-5 rounded-inherit"><div ref={discardRef} role="alertdialog" aria-modal="true" aria-label="放弃未保存的修改？" className={`w-full rounded-2xl p-5 ${night ? 'bg-night-card shadow-xl' : 'chat-dialog'}`}><p className="text-sm">放弃未保存的修改？</p><div className="mt-5 flex justify-end gap-3"><button className={button} onClick={() => { setPendingDiscard(null); dialog.current?.focus() }}>继续编辑</button><button className={button} onClick={() => { const action = pendingDiscard; setPendingDiscard(null); action() }}>放弃修改</button></div></div></div>}
    </div>
  </>
}
