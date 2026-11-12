'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useChatStore } from '@/lib/chatStore'
import { apiRequest } from '@/lib/api'
import { withoutOpus55ThinkingInstructions } from '@/lib/cc-system-prompt'

export type ChatSettingsPanel = 'menu' | 'star' | 'settings'
type RoomUnreadKey = 'coupons' | 'todo' | 'notes' | 'diary' | 'wishlist' | 'photos' | 'favorites' | 'media' | 'energy' | 'poems' | 'stories' | 'research' | 'tesis' | 'future' | 'dictionary' | 'engawa'
interface Props {
  open: boolean
  onClose: () => void
  initialPanel?: ChatSettingsPanel
  onCoupons?: () => void
  onTodo?: () => void
  onTesis?: () => void
  onNotes?: () => void
  onDiary?: () => void
  onPhotos?: () => void
  onPoems?: () => void
  onStories?: () => void
  onResearch?: () => void
  onFutureLetter?: () => void
  onDictionary?: () => void
  onWishlist?: () => void
  onMedia?: () => void
  onEnergy?: () => void
  onFavorites?: () => void
  onGames?: () => void
  onEngawa?: () => void
}

export function ChatSettings(props: Props) {
  const { open, onClose, initialPanel = 'menu' } = props
  const { settings, setSettings } = useChatStore()
  const [panel, setPanel] = useState<ChatSettingsPanel>(initialPanel)
  const [promptTarget, setPromptTarget] = useState<'base' | 'opus55'>('base')
  const [editing, setEditing] = useState<'base' | 'opus55' | 'style46' | null>(null)
  const [expandedPrompt, setExpandedPrompt] = useState<'base' | 'opus55' | 'style46' | null>(null)
  const [draft, setDraft] = useState('')
  const [original, setOriginal] = useState('')
  const [error, setError] = useState('')
  const [roomUnread, setRoomUnread] = useState<Partial<Record<RoomUnreadKey, number>>>({})
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null)
  const discardRef = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const confirm = (action: () => void) => {
    if (editing && draft !== original) {
      const run = () => { setEditing(null); setError(''); action() }
      setPendingDiscard(() => run)
    } else { setEditing(null); setError(''); action() }
  }
  const close = () => { if (pendingDiscard) setPendingDiscard(null); else confirm(onClose) }
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!open) return
    setPanel(initialPanel); setEditing(null); setExpandedPrompt(null); setError('')
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
  const card = 'chat-theme-panel chat-theme-border border'
  const button = `chat-theme-hover px-4 py-2.5 rounded-xl text-sm ${card}`
  const titles = { menu: 'Rooms', star: 'SP', settings: '参数' }
  const navigate = (action?: () => void) => { onClose(); action?.() }
  const openRoom = (room: RoomUnreadKey, action?: () => void) => {
    setRoomUnread(current => ({ ...current, [room]: 0 }))
    void apiRequest('/api/room-unread', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room }) }).catch(() => {})
    navigate(action)
  }
  const room = (label: string, action: () => void, badge = 0) => <button key={label} onClick={action} className="chat-room-link chat-theme-hover flex min-w-0 items-center gap-1.5 px-2 py-2 text-left">
    {badge > 0 && <span aria-hidden="true" className="chat-theme-accent-bg h-1.5 w-1.5 shrink-0 rounded-full"/>}<span className="min-w-0 flex-1 truncate text-[11px] leading-5">{label}</span>{badge > 0 && <span aria-label={`${badge} 条未读`} className="chat-theme-accent text-[8px]">+{badge > 99 ? '99' : badge}</span>}<ChevronRight className="chat-theme-muted shrink-0 opacity-55" size={11}/>
  </button>
  const slider = (label: string, value: number, change: (v: number) => void, min = 0, max = 1, step = .05, display?: string) => <label className="block space-y-2 text-xs"><span className="flex justify-between gap-2"><span>{label}</span><span className="opacity-60">{display || `${Math.round(value * 100)}%`}</span></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => change(Number(e.target.value))} className="w-full"/></label>
  const toggle = (label: string, checked: boolean, action: () => void) => <button role="switch" aria-checked={checked} onClick={action} className="w-full flex items-center justify-between py-2 text-sm"><span>{label}</span><span className={`w-10 h-6 rounded-full p-0.5 ${checked ? 'chat-theme-accent-bg' : 'chat-theme-soft'}`}><span className={`block w-5 h-5 bg-white rounded-full transition-transform ${checked ? 'translate-x-4' : ''}`}/></span></button>
  const promptEditor = (target: 'base' | 'opus55' | 'style46', label: string, value: string, empty: string, note: string) => <section className="space-y-3">
    {editing === target ? <><div className="flex items-center justify-between gap-2"><span className="text-sm">{label}</span></div><textarea autoFocus aria-label={`编辑${label}`} value={draft} onChange={e => setDraft(e.target.value)} className={`w-full min-h-[50dvh] rounded-2xl p-4 text-sm leading-7 outline-none ${card}`}/></> : <div className={`overflow-hidden rounded-2xl ${card}`}>
      <div className="flex items-center gap-2 px-4 py-3"><button type="button" aria-expanded={expandedPrompt === target} onClick={() => setExpandedPrompt(current => current === target ? null : target)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><span className="min-w-0 flex-1"><span className="block text-sm">{label}</span><span className="mt-1 block truncate text-[10px] opacity-45">{value ? `已设置 · ${value.length.toLocaleString('zh-CN')} 字` : empty} · {note}</span></span>{expandedPrompt === target ? <ChevronDown size={15} className="shrink-0 opacity-45"/> : <ChevronRight size={15} className="shrink-0 opacity-45"/>}</button><button className={`${button} shrink-0`} onClick={() => { setOriginal(value); setDraft(value); setEditing(target); setError('') }}>编辑</button></div>
      {expandedPrompt === target && <div className="chat-theme-border max-h-56 overflow-y-auto whitespace-pre-wrap break-words border-t px-4 py-3 text-xs leading-6 opacity-70">{value || empty}</div>}
    </div>}
    {editing === target && error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {editing === target && <div className="flex justify-end gap-3"><button className={button} onClick={() => confirm(() => setEditing(null))}>取消</button><button className={`${button} font-medium`} onClick={() => {
      const current = useChatStore.getState().settings
      const latest = target === 'base' ? current.systemPrompt : target === 'opus55' ? current.ccOpus55SystemPrompt : current.ccOpus46OutputStyle
      if (latest !== original) { setError('内容已在别处修改，请取消后重新编辑。'); return }
      setSettings(target === 'base'
        ? { systemPrompt: draft }
        : target === 'opus55'
          ? { ccOpus55SystemPrompt: withoutOpus55ThinkingInstructions(draft) }
          : { ccOpus46OutputStyle: draft })
      setEditing(null); setError('')
    }}>保存</button></div>}
  </section>
  return <>
    <div className="fixed inset-0 z-[70] bg-black/30" onClick={close}/>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="chat-menu-title" className={`chat-theme chat-theme-ui chat-theme-border fixed ${panel !== 'menu' ? 'chat-theme-surface inset-x-4 mx-auto top-[8dvh] max-h-[84dvh] max-w-[640px] rounded-2xl border' : 'chat-page-shell chat-room-drawer bottom-0 right-0 top-0 w-[86vw] max-w-[340px] border-l'} z-[71] flex flex-col overflow-hidden shadow-2xl outline-none`}>
      <div className={`relative z-10 flex items-center gap-3 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] ${panel === 'menu' ? 'chat-room-header' : 'chat-theme-border border-b'}`}>
        {panel === 'menu' ? <h2 id="chat-menu-title" className="chat-session-title text-[28px] font-bold leading-none">Rooms</h2> : <>
          <button aria-label={initialPanel === 'menu' ? '返回房间' : '关闭'} onClick={() => initialPanel === 'menu' ? confirm(() => setPanel('menu')) : close()} className="p-2"><ChevronLeft size={20}/></button>
          <h2 id="chat-menu-title" className="flex-1 font-medium">{titles[panel]}</h2>
        </>}
      </div>
      <div className={`flex-1 min-h-0 overflow-y-auto p-4 ${panel === 'menu' ? 'space-y-4' : 'space-y-4'}`}>
        {panel === 'menu' && <>
          <section className="chat-room-card px-3 pb-2 pt-5">
            <h3 className="chat-session-title mb-2 px-2 text-[11px] font-bold tracking-[.14em] opacity-65">DAILY</h3>
            <div className="grid grid-cols-2">{room('日记', () => openRoom('diary', props.onDiary), roomUnread.diary)}{room('Todo', () => openRoom('todo', props.onTodo), roomUnread.todo)}{room('小纸条', () => openRoom('notes', props.onNotes), roomUnread.notes)}{room('照片', () => openRoom('photos', props.onPhotos), roomUnread.photos)}{room('饮食运动', () => openRoom('energy', props.onEnergy), roomUnread.energy)}{room('Tesis', () => openRoom('tesis', props.onTesis), roomUnread.tesis)}</div>
          </section>
          <section className="chat-room-card px-3 pb-2 pt-5">
            <h3 className="chat-session-title mb-2 px-2 text-[11px] font-bold tracking-[.14em] opacity-65">KEEPSAKES</h3>
            <div className="grid grid-cols-2">{room('书影记录', () => openRoom('media', props.onMedia), roomUnread.media)}{room('券包', () => openRoom('coupons', props.onCoupons), roomUnread.coupons)}{room('收藏夹', () => openRoom('favorites', props.onFavorites), roomUnread.favorites)}{room('小火辞典', () => openRoom('dictionary', props.onDictionary), roomUnread.dictionary)}{room('醒来以后', () => openRoom('future', props.onFutureLetter), roomUnread.future)}{room('愿望清单', () => openRoom('wishlist', props.onWishlist), roomUnread.wishlist)}</div>
          </section>
          <section className="chat-room-card px-3 pb-2 pt-5">
            <h3 className="chat-session-title mb-2 px-2 text-[11px] font-bold tracking-[.14em] opacity-65">TOGETHER</h3>
            <div className="grid grid-cols-2">{room('共诗', () => openRoom('poems', props.onPoems), roomUnread.poems)}{room('枕边集', () => openRoom('stories', props.onStories), roomUnread.stories)}{room('星野手记', () => openRoom('research', props.onResearch), roomUnread.research)}{room('小游戏', () => navigate(props.onGames))}{room('豹子的窗台', () => openRoom('engawa', props.onEngawa), roomUnread.engawa)}</div>
          </section>
        </>}
        {panel === 'star' && <>
          <div role="tablist" aria-label="选择模型人设" className={`grid grid-cols-2 gap-1 rounded-2xl p-1 ${card}`}>
            {([['base', 'Opus 4.6'], ['opus55', '5.5 / Fable 5.2']] as const).map(([target, label]) => <button key={target} role="tab" aria-selected={promptTarget === target} onClick={() => confirm(() => setPromptTarget(target))} className={`rounded-xl px-3 py-2 text-sm ${promptTarget === target ? 'chat-theme-surface shadow-sm' : 'opacity-55'}`}>{label}</button>)}
          </div>
          {promptTarget === 'base'
            ? <>{promptEditor('base', '现有人设（保持原样）', settings.systemPrompt, '尚未设置人设', '修改后相关 CC 窗口会重建 session')}{promptEditor('style46', '星星本色（回复风格）', settings.ccOpus46OutputStyle, '未设置回复风格', '不改变 session')}</>
            : promptEditor('opus55', '5.5 / Fable 5.2 专用人设（思考不显示）', settings.ccOpus55SystemPrompt, '将自动使用移除思考链要求后的现有人设', '修改后相关 CC 窗口会重建 session')}
        </>}
        {panel === 'settings' && <>
          {slider('温度', settings.temperature, v => setSettings({ temperature: v }), 0, 2, .05, settings.temperature.toFixed(2))}
          {slider('思考预算', settings.thinkingBudget, v => setSettings({ thinkingBudget: v }), 0, 32000, 1000, `${settings.thinkingBudget} tok`)}
          {toggle('流式输出', settings.streamEnabled, () => setSettings({ streamEnabled: !settings.streamEnabled }))}
          {toggle('Prompt Caching', settings.promptCaching, () => setSettings({ promptCaching: !settings.promptCaching }))}
          {slider('上下文条数', settings.contextLength, v => setSettings({ contextLength: v }), 4, 200, 2, String(settings.contextLength))}
        </>}
      </div>
      {pendingDiscard && <div className="absolute inset-0 z-10 bg-black/40 flex items-center justify-center p-5 rounded-inherit"><div ref={discardRef} role="alertdialog" aria-modal="true" aria-label="放弃未保存的修改？" className="chat-theme-surface chat-theme-border w-full rounded-2xl border p-5 shadow-xl"><p className="text-sm">放弃未保存的修改？</p><div className="mt-5 flex justify-end gap-3"><button className={button} onClick={() => { setPendingDiscard(null); dialog.current?.focus() }}>继续编辑</button><button className={button} onClick={() => { const action = pendingDiscard; setPendingDiscard(null); action() }}>放弃修改</button></div></div></div>}
    </div>
  </>
}
