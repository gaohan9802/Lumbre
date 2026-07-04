'use client'

/**
 * 星星设置 — system prompt、温度、思考预算、流式、上下文、外观（背景/气泡）。
 * 与模型解绑；全平台经 /api/sync config 同步。
 */
import { useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, RotateCcw, Trash2, ImagePlus } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { useChatStore, estimateTokens, DEFAULT_APPEARANCE } from '@/lib/chatStore'

interface Props {
  open: boolean
  onClose: () => void
  onConfirm: (message: string, action: () => void) => void
}

async function fileToDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })
  if (raw.length < 900_000) return raw
  const img = document.createElement('img')
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = raw })
  const scale = Math.min(1, 1920 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.82)
}

export function ChatSettings({ open, onClose, onConfirm }: Props) {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const { messages, settings, setSettings, resetSettings, clearMessages } = useChatStore()
  const bgInputRef = useRef<HTMLInputElement>(null)
  const [bgUploading, setBgUploading] = useState(false)

  const systemTokens = estimateTokens(settings.systemPrompt)
  const sentSlice = messages.slice(-settings.contextLength)
  const sentTokens = sentSlice.reduce((s, m) => s + estimateTokens(m.content), 0)
  const ap = settings.appearance

  const setAppearance = (patch: Partial<typeof ap>) => setSettings({ appearance: { ...ap, ...patch } })

  const uploadBg = async (file: File) => {
    setBgUploading(true)
    try {
      const url = await fileToDataUrl(file)
      setAppearance({ bgImage: url })
    } catch {}
    setBgUploading(false)
  }

  const sliderRow = (label: string, value: number, onChange: (v: number) => void, min = 0, max = 1, step = 0.05, fmt?: (v: number) => string) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] opacity-60">{label}</span>
        <span className="text-[11px] opacity-80">{fmt ? fmt(value) : `${Math.round(value * 100)}%`}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-full" />
    </div>
  )

  const colorRow = (label: string, color: string, opacity: number, onColor: (c: string) => void, onOpacity: (o: number) => void, defaultHint: string) => (
    <div className={`p-3 rounded-xl space-y-2 ${isNight ? 'bg-night-surface/70' : 'bg-gray-50'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs opacity-70">{label}</span>
        <div className="flex items-center gap-2">
          <input type="color" value={color || defaultHint} onChange={(e) => onColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 bg-transparent" />
          {color && <button onClick={() => onColor('')} className="text-[10px] underline opacity-50 hover:opacity-100">恢复默认</button>}
        </div>
      </div>
      {sliderRow('透明度', opacity, onOpacity, 0.1, 1)}
    </div>
  )

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            className={`fixed right-0 top-0 bottom-0 w-full sm:w-[480px] z-50 overflow-y-auto ${isNight ? 'bg-night-surface border-l border-night-border' : 'bg-white border-l border-day-border'} pb-[env(safe-area-inset-bottom)]`}
          >
            <div className="sticky top-0 z-10 backdrop-blur-md bg-inherit px-6 py-4 flex items-center justify-between border-b border-current/5">
              <div>
                <h3 className="font-medium">🐆 星星设置</h3>
                <p className="text-[10px] opacity-40 mt-0.5">人设与参数不跟模型走，切模型也不变</p>
              </div>
              <button onClick={onClose} className="p-1 opacity-60 hover:opacity-100"><X size={18} /></button>
            </div>

            <div className="p-6 space-y-7">
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">System Prompt / 人设</label>
                  <span className="text-[10px] opacity-40">~{systemTokens} tok</span>
                </div>
                <textarea
                  value={settings.systemPrompt}
                  onChange={(e) => setSettings({ systemPrompt: e.target.value })}
                  rows={8}
                  placeholder="给星星定一个底色…"
                  className={`w-full text-sm leading-relaxed p-3 rounded-xl outline-none resize-y ${isNight ? 'bg-night-card text-night-text placeholder:text-night-muted' : 'bg-gray-50 text-day-text placeholder:text-day-muted'}`}
                />
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">温度 Temperature</label>
                  <span className="text-xs opacity-80">{settings.temperature.toFixed(2)}</span>
                </div>
                <input type="range" min={0} max={2} step={0.05} value={settings.temperature} onChange={(e) => setSettings({ temperature: parseFloat(e.target.value) })} className="w-full" />
                <p className="text-[10px] opacity-40">Anthropic 上限 1（自动截断）；开启思考时 Anthropic 会忽略温度。</p>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">思考预算 Thinking Budget</label>
                  <span className="text-xs opacity-60">{settings.thinkingBudget > 0 ? `${settings.thinkingBudget} tok` : 'off'}</span>
                </div>
                <input type="range" min={0} max={32000} step={1000} value={settings.thinkingBudget} onChange={(e) => setSettings({ thinkingBudget: parseInt(e.target.value) })} className="w-full" />
                <div className="text-[10px] opacity-40 flex justify-between"><span>off</span><span>32k</span></div>
              </section>

              <section className="flex items-center justify-between">
                <div>
                  <p className="text-xs opacity-60">流式输出 Streaming</p>
                  <p className="text-[10px] opacity-40 mt-1">逐字显示回复（当前版本先整段返回，开关预留）。</p>
                </div>
                <button onClick={() => setSettings({ streamEnabled: !settings.streamEnabled })} className={`relative w-10 h-6 rounded-full transition flex-shrink-0 ${settings.streamEnabled ? (isNight ? 'bg-night-amber' : 'bg-day-pink') : 'bg-gray-300 dark:bg-night-card'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${settings.streamEnabled ? 'translate-x-4' : ''}`} />
                </button>
              </section>

              <section className="flex items-center justify-between">
                <div>
                  <p className="text-xs opacity-60">Prompt Caching</p>
                  <p className="text-[10px] opacity-40 mt-1">Anthropic 原生支持；兼容站点通常忽略。</p>
                </div>
                <button onClick={() => setSettings({ promptCaching: !settings.promptCaching })} className={`relative w-10 h-6 rounded-full transition flex-shrink-0 ${settings.promptCaching ? (isNight ? 'bg-night-amber' : 'bg-day-pink') : 'bg-gray-300 dark:bg-night-card'}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${settings.promptCaching ? 'translate-x-4' : ''}`} />
                </button>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">Context — 抓取最近多少条</label>
                  <span className="text-xs"><span className={isNight ? 'text-night-amber' : 'text-day-pink'}>{settings.contextLength}</span><span className="opacity-40"> / {messages.length}</span></span>
                </div>
                <input type="range" min={4} max={200} step={2} value={settings.contextLength} onChange={(e) => setSettings({ contextLength: parseInt(e.target.value) })} className="w-full" />
                <div className="text-[10px] opacity-40 flex justify-between"><span>4</span><span>本轮发送 ~{sentTokens} tok</span><span>200</span></div>
              </section>

              {/* ── 外观 ── */}
              <section className="space-y-3 pt-4 border-t border-current/10">
                <label className="text-xs opacity-60">外观 · 背景图片</label>
                <input ref={bgInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBg(f); e.target.value = '' }} />
                <div className="flex items-center gap-3">
                  <button onClick={() => bgInputRef.current?.click()} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs ${isNight ? 'bg-night-card' : 'bg-gray-100'}`}>
                    <ImagePlus size={13} /> {bgUploading ? '处理中…' : ap.bgImage ? '更换背景' : '上传背景'}
                  </button>
                  {ap.bgImage && (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={ap.bgImage} alt="" className="w-12 h-12 rounded-lg object-cover" />
                      <button onClick={() => setAppearance({ bgImage: '' })} className="text-[10px] underline opacity-50 hover:opacity-100">移除</button>
                    </>
                  )}
                </div>
                {ap.bgImage && sliderRow('背景透明度', ap.bgOpacity, (v) => setAppearance({ bgOpacity: v }), 0.05, 1)}

                {colorRow('我的气泡', ap.userBubbleColor, ap.userBubbleOpacity, (c) => setAppearance({ userBubbleColor: c }), (o) => setAppearance({ userBubbleOpacity: o }), isNight ? '#3d3524' : '#f7e8b5')}
                {colorRow('星星的气泡', ap.aiBubbleColor, ap.aiBubbleOpacity, (c) => setAppearance({ aiBubbleColor: c }), (o) => setAppearance({ aiBubbleOpacity: o }), isNight ? '#26231d' : '#ffffff')}
                <button onClick={() => setSettings({ appearance: { ...DEFAULT_APPEARANCE } })} className="text-[10px] underline opacity-50 hover:opacity-100">外观全部恢复默认</button>
              </section>

              <section className="pt-4 border-t border-current/10 space-y-2">
                <button onClick={() => onConfirm('恢复默认设置？API、供应商和会话都会重置。', resetSettings)} className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs opacity-60 hover:opacity-100 hover:bg-day-tint dark:hover:bg-white/5"><RotateCcw size={12} /> 恢复默认</button>
                <button onClick={() => onConfirm(`清空当前会话 ${messages.length} 条聊天？这不能撤销。`, clearMessages)} className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs text-day-error dark:text-night-error/80 hover:bg-day-errorLight/30"><Trash2 size={12} /> 清空当前对话（{messages.length} 条）</button>
              </section>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
