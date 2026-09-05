'use client'

import { useEffect, useRef, useState } from 'react'
import { X, ChevronLeft, ChevronRight, ImagePlus, PanelsTopLeft } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { useChatStore } from '@/lib/chatStore'
import { bubbleAppearance } from '@/features/chat/settings/appearance'

type Panel = 'menu' | 'star' | 'settings' | 'wallpaper' | 'models'
interface Props {
  open: boolean
  onClose: () => void
  onSummary?: () => void
  onBookmarks?: () => void
  onCoupons?: () => void
  onModelPicker?: () => void
  onModelManager?: () => void
}

async function imageData(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
  if (raw.length < 900_000) return raw
  const img = new Image()
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = raw })
  const scale = Math.min(1, 1920 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', .82)
}

export function ChatSettings(props: Props) {
  const { open, onClose } = props
  const { theme } = useTheme()
  const night = theme === 'night'
  const { settings, setSettings, continueSession } = useChatStore()
  const [panel, setPanel] = useState<Panel>('menu')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [original, setOriginal] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [pendingDiscard, setPendingDiscard] = useState<(() => void) | null>(null)
  const discardRef = useRef<HTMLDivElement>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const upload = useRef<HTMLInputElement>(null)
  const ap = settings.appearance
  const setAppearance = (patch: Partial<typeof ap>) => setSettings({ appearance: { ...ap, ...patch } })
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
    setPanel('menu'); setEditing(false); setError('')
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
  }, [open])
  useEffect(() => { if (open) dialog.current?.focus() }, [panel, open])
  useEffect(() => { if (pendingDiscard) discardRef.current?.querySelector('button')?.focus() }, [pendingDiscard])
  if (!open) return null
  const card = night ? 'bg-night-card' : 'bg-gray-50'
  const button = `px-4 py-2.5 rounded-xl text-sm ${card}`
  const activeSession = settings.sessions.find(s => s.id === settings.activeSessionId)
  const profile = settings.apiProfiles.find(p => p.id === settings.activeProfileId)
  const titles = { menu: '聊天', star: '星星', settings: '设置', wallpaper: '壁纸', models: '模型' }
  const navigate = (action?: () => void) => { onClose(); action?.() }
  const row = (label: string, action: () => void, detail?: string) => <button key={label} onClick={action} className={`w-full flex items-center gap-3 p-4 rounded-2xl text-left ${card}`}><span className="flex-1 min-w-0"><span className="block text-sm">{label}</span>{detail && <span className="block text-xs opacity-50 truncate mt-1">{detail}</span>}</span><ChevronRight size={16}/></button>
  const slider = (label: string, value: number, change: (v: number) => void, min = 0, max = 1, step = .05, display?: string) => <label className="block space-y-2 text-xs"><span className="flex justify-between gap-2"><span>{label}</span><span className="opacity-60">{display || `${Math.round(value * 100)}%`}</span></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e => change(Number(e.target.value))} className="w-full"/></label>
  const toggle = (label: string, checked: boolean, action: () => void) => <button role="switch" aria-checked={checked} onClick={action} className="w-full flex items-center justify-between py-2 text-sm"><span>{label}</span><span className={`w-10 h-6 rounded-full p-0.5 ${checked ? 'bg-day-pink' : 'bg-gray-400/40'}`}><span className={`block w-5 h-5 bg-white rounded-full transition-transform ${checked ? 'translate-x-4' : ''}`}/></span></button>
  const bubbleControls = (who: 'user' | 'ai', label: string) => {
    const suffix = night ? 'Night' : ''
    const colorKey = `${who}BubbleColor${suffix}` as keyof typeof ap
    const opacityKey = `${who}BubbleOpacity${suffix}` as keyof typeof ap
    const blurKey = `${who}BubbleBlur${suffix}` as keyof typeof ap
    const enabledKey = `${who}BubbleFrosted${suffix}` as keyof typeof ap
    const style = bubbleAppearance(ap, who, night)
    return <section className={`rounded-2xl p-4 space-y-4 ${card}`}>
      <div className="flex items-center justify-between"><span className="text-sm">{label}</span><input aria-label={`${label}颜色`} type="color" value={String(ap[colorKey] || (who === 'user' ? (night ? '#e2a84b' : '#f3a4ac') : (night ? '#243040' : '#ffffff')))} onChange={e => setAppearance({ [colorKey]: e.target.value })} className="w-9 h-9 bg-transparent"/></div>
      {slider(`${label}透明度`, Number(ap[opacityKey]), v => setAppearance({ [opacityKey]: v }), .1, 1)}
      {toggle(`${label}磨砂`, ap[enabledKey] !== false, () => setAppearance({ [enabledKey]: ap[enabledKey] === false }))}
      {ap[enabledKey] !== false && slider(`${label}磨砂强度`, Number(ap[blurKey] ?? 2), v => setAppearance({ [blurKey]: v }), 0, 20, 1, `${Math.round(Number(ap[blurKey] ?? 2) * 5)}%`)}
      <div className="p-4 rounded-xl bg-gradient-to-r from-pink-200 via-amber-100 to-sky-200"><span className="inline-block rounded-2xl px-4 py-2 text-sm" style={style}>在这里，陪你聊天。</span></div>
    </section>
  }
  return <>
    <div className="fixed inset-0 z-[70] bg-black/30" onClick={close}/>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="chat-menu-title" className={`fixed ${panel === 'star' ? 'inset-x-4 mx-auto top-[8dvh] h-[84dvh] max-w-[640px] rounded-2xl' : 'right-0 top-0 bottom-0 w-full sm:w-[420px]'} z-[71] flex flex-col outline-none shadow-2xl ${night ? 'bg-night-surface text-night-text' : 'bg-white text-day-text'}`}>
      <div className="flex items-center gap-3 px-5 pb-4 pt-[max(1rem,env(safe-area-inset-top))] border-b border-current/10">
        {panel !== 'menu' && <button aria-label="返回菜单" onClick={() => confirm(() => setPanel('menu'))} className="p-2"><ChevronLeft size={20}/></button>}
        <h2 id="chat-menu-title" className="flex-1 font-medium">{titles[panel]}</h2><button aria-label="关闭菜单" onClick={close} className="p-2"><X size={20}/></button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4">
        {panel === 'menu' && <>
          {row('星星', () => setPanel('star'))}
          {row('摘要', () => navigate(props.onSummary), `${activeSession?.summaries?.length || 0} 张`)}
          {row('书签', () => navigate(props.onBookmarks), `${settings.bookmarks.length} 张`)}
          {row('券包', () => navigate(props.onCoupons))}
          {row('模型', () => setPanel('models'), `${profile?.name || '未配置'} · ${settings.model}`)}
          {row('设置', () => setPanel('settings'))}
          {row('壁纸', () => setPanel('wallpaper'))}
          <p className="text-xs opacity-40 px-2">共 {activeSession?.messageCount || activeSession?.messages.length || 0} 层</p>
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
        {panel === 'models' && <>{row('切换模型', () => navigate(props.onModelPicker), `${profile?.name || '未配置'} · ${settings.model}`)}{row('API 管理', () => navigate(props.onModelManager))}</>}
        {panel === 'settings' && <>
          {slider('温度', settings.temperature, v => setSettings({ temperature: v }), 0, 2, .05, settings.temperature.toFixed(2))}
          {slider('思考预算', settings.thinkingBudget, v => setSettings({ thinkingBudget: v }), 0, 32000, 1000, `${settings.thinkingBudget} tok`)}
          {toggle('流式输出', settings.streamEnabled, () => setSettings({ streamEnabled: !settings.streamEnabled }))}
          {toggle('Prompt Caching', settings.promptCaching, () => setSettings({ promptCaching: !settings.promptCaching }))}
          {slider('上下文条数', settings.contextLength, v => setSettings({ contextLength: v }), 4, 200, 2, String(settings.contextLength))}
        </>}
        {panel === 'wallpaper' && <>
          <input ref={upload} type="file" accept="image/*" hidden onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setUploading(true); setError(''); try { setAppearance({ bgImage: await imageData(file) }) } catch { setError('图片处理失败，请重试。') } finally { setUploading(false) } }}/>
          <div className="flex items-center gap-3"><button disabled={uploading} className={`${button} flex items-center gap-2`} onClick={() => upload.current?.click()}><ImagePlus size={16}/>{uploading ? '处理中…' : ap.bgImage ? '更换壁纸' : '上传壁纸'}</button>{ap.bgImage && <button className={button} onClick={() => setAppearance({ bgImage: '' })}>移除壁纸</button>}</div>
          {ap.bgImage && <>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={ap.bgImage} alt="当前壁纸" className="max-h-40 rounded-2xl object-cover w-full"/>{slider('壁纸透明度', ap.bgOpacity, v => setAppearance({ bgOpacity: v }), .05, 1)}</>}
          <p className="text-xs opacity-50">{night ? '夜间' : '日间'}</p>
          {bubbleControls('user', '我的气泡')}{bubbleControls('ai', '星星的气泡')}
          {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
        </>}
      </div>
      {pendingDiscard && <div className="absolute inset-0 z-10 bg-black/40 flex items-center justify-center p-5 rounded-inherit"><div ref={discardRef} role="alertdialog" aria-modal="true" aria-label="放弃未保存的修改？" className={`w-full rounded-2xl p-5 shadow-xl ${night ? 'bg-night-card' : 'bg-white'}`}><p className="text-sm">放弃未保存的修改？</p><div className="mt-5 flex justify-end gap-3"><button className={button} onClick={() => { setPendingDiscard(null); dialog.current?.focus() }}>继续编辑</button><button className={button} onClick={() => { const action = pendingDiscard; setPendingDiscard(null); action() }}>放弃修改</button></div></div></div>}
      {panel === 'menu' && <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] border-t border-current/10"><button onClick={() => { continueSession(50); onClose() }} className={`w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm ${night ? 'bg-night-amber/15 text-night-amber' : 'bg-day-lemon'}`}><PanelsTopLeft size={16}/>换窗</button></div>}
    </div>
  </>
}
