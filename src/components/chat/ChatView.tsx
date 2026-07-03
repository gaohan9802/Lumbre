'use client'

import { useState, useRef, useEffect } from 'react'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, ChevronDown, Settings2, PanelLeft, Plus, Pin, Trash2, Pencil, Search, X, ImagePlus, RotateCcw, GitBranch } from 'lucide-react'
import {
  useChatStore,
  ChatMessage,
  getActiveProfile,
  getEnabledModels,
  getSortedSessions,
  estimateTokens,
} from '@/lib/chatStore'
import { chat } from '@/lib/api'
import { useWeather, weatherEmoji } from '@/lib/useWeather'
import { ChatSettings } from './ChatSettings'

const p2 = (n: number) => String(n).padStart(2, '0')
const formatFullTs = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}
const formatDuration = (ms: number) => {
  if (ms < 60000) return '刚刚开始'
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时 ${m % 60} 分`
  const d = Math.floor(h / 24)
  return `${d} 天 ${h % 24} 小时`
}

async function fileToDataUrl(file: File): Promise<string> {
  const raw = await new Promise<string>((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(file)
  })
  if (raw.length < 800_000) return raw
  // downscale large images for API friendliness
  const img = document.createElement('img')
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = raw })
  const scale = Math.min(1, 1568 / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

export function ChatView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const {
    messages,
    settings,
    addMessage,
    createSession,
    setActiveSession,
    renameSession,
    deleteSession,
    togglePinSession,
    setActiveModel,
    deleteMessage,
    truncateFrom,
    branchFromMessage,
  } = useChatStore()
  const activeProfile = getActiveProfile(settings)
  const enabledModels = getEnabledModels(settings)
  const sessions = getSortedSessions(settings)
  const activeSession = settings.sessions.find((s) => s.id === settings.activeSessionId)
  const weather = useWeather()

  const [input, setInput] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set())
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [sessionSearch, setSessionSearch] = useState('')
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [nowTick, setNowTick] = useState(Date.now())

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [input])

  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 30000)
    return () => clearInterval(iv)
  }, [])

  // ── context window stats ──
  const contextSlice = messages.slice(-settings.contextLength)
  const windowDuration = contextSlice.length ? nowTick - contextSlice[0].timestamp : 0
  const contextTokens = contextSlice.reduce((sum, m) => sum + estimateTokens(m.content) + (m.images?.length || 0) * 1200, 0)
  const contextPct = Math.min(100, Math.round((contextSlice.length / Math.max(settings.contextLength, 1)) * 100))

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
    for (const f of list.slice(0, 4 - images.length)) {
      try {
        const url = await fileToDataUrl(f)
        setImages((prev) => (prev.length >= 4 ? prev : [...prev, url]))
      } catch {}
    }
  }

  const runInference = async (history: ChatMessage[]) => {
    const profile = getActiveProfile(settings)
    const model = settings.model
    setIsLoading(true)
    try {
      const slice = history.slice(-settings.contextLength)
      const data = await chat.send({
        messages: slice.map((m) => ({ role: m.role, content: m.content, images: m.images })),
        system: settings.systemPrompt || undefined,
        model,
        thinking_budget: settings.thinkingBudget,
        prompt_caching: settings.promptCaching,
        api_profile: profile ? {
          provider: profile.provider,
          baseUrl: profile.baseUrl,
          apiKey: profile.apiKey,
          modelId: model,
        } : undefined,
      })

      addMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.content || data.error || '...',
        timestamp: Date.now(),
        thinking: data.thinking,
        input_tokens: data.input_tokens,
        output_tokens: data.output_tokens,
        cache_read_tokens: data.cache_read_tokens,
        cache_creation_tokens: data.cache_creation_tokens,
        tool_calls: data.tool_calls,
        providerId: profile?.id,
        modelId: model,
      })
    } catch (err: any) {
      addMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: err?.message || '连接失败了…',
        timestamp: Date.now(),
        providerId: profile?.id,
        modelId: model,
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSend = async () => {
    if ((!input.trim() && !images.length) || isLoading) return
    const profile = getActiveProfile(settings)
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
      images: images.length ? images : undefined,
      providerId: profile?.id,
      modelId: settings.model,
    }
    addMessage(userMsg)
    setInput('')
    setImages([])
    await runInference([...messages, userMsg])
  }

  const handleReroll = (msgId: string) => {
    if (isLoading) return
    const idx = messages.findIndex((m) => m.id === msgId)
    if (idx < 0) return
    const base = messages.slice(0, idx)
    truncateFrom(msgId)
    runInference(base)
  }

  const handleBranch = (msgId: string) => {
    branchFromMessage(msgId)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    if (e.clipboardData?.files?.length) {
      e.preventDefault()
      addFiles(e.clipboardData.files)
    }
  }

  const toggleThinking = (id: string) => {
    setExpandedThinking((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleTools = (id: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    const today = new Date()
    if (d.toDateString() === today.toDateString()) return `${p2(d.getHours())}:${p2(d.getMinutes())}`
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  }

  const filteredSessions = sessions.filter((s) =>
    !sessionSearch.trim() || s.title.toLowerCase().includes(sessionSearch.toLowerCase()),
  )

  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const cacheHit = lastAssistant?.cache_read_tokens && lastAssistant.cache_read_tokens > 0

  const startRename = (id: string, title: string) => {
    setEditingSessionId(id)
    setEditingTitle(title)
  }

  const finishRename = () => {
    if (editingSessionId) renameSession(editingSessionId, editingTitle)
    setEditingSessionId(null)
    setEditingTitle('')
  }

  const weatherChip = weather && (
    <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full flex-shrink-0 ${isNight ? 'bg-night-surface text-night-muted' : 'bg-day-lemon text-day-muted'}`}>
      {weatherEmoji(weather.code)} {weather.temp != null ? `${Math.round(weather.temp)}°` : ''}{weather.city ? ` · ${weather.city}` : ''}
    </span>
  )

  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <div className={`h-full flex flex-col ${mobile ? 'w-[86vw] max-w-[340px]' : 'w-[300px]'} ${isNight ? 'bg-night-card border-night-border' : 'bg-white border-day-border'} border-r`}>
      <div className="p-4 space-y-3 border-b border-current/5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">会话</div>
            <div className="text-[10px] opacity-40">{settings.sessions.length} 条对话</div>
          </div>
          {mobile && <button onClick={() => setSessionDrawerOpen(false)} className="p-2 opacity-60"><X size={16} /></button>}
        </div>
        <button
          onClick={() => { createSession(); if (mobile) setSessionDrawerOpen(false) }}
          className={`w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs ${isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}
        >
          <Plus size={13} /> 新对话
        </button>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${isNight ? 'bg-night-surface' : 'bg-gray-50'}`}>
          <Search size={13} className="opacity-40" />
          <input
            value={sessionSearch}
            onChange={(e) => setSessionSearch(e.target.value)}
            placeholder="搜索会话"
            className="bg-transparent outline-none text-xs flex-1"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredSessions.map((s) => {
          const active = s.id === settings.activeSessionId
          return (
            <div
              key={s.id}
              onClick={() => { setActiveSession(s.id); if (mobile) setSessionDrawerOpen(false) }}
              className={`group p-3 rounded-xl cursor-pointer transition ${
                active
                  ? isNight ? 'bg-night-amber/15 text-night-text' : 'bg-day-pinkLight text-day-text'
                  : isNight ? 'hover:bg-night-surface' : 'hover:bg-gray-50'
              }`}
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  {editingSessionId === s.id ? (
                    <input
                      value={editingTitle}
                      autoFocus
                      onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={finishRename}
                      onKeyDown={(e) => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') setEditingSessionId(null) }}
                      onClick={(e) => e.stopPropagation()}
                      className={`w-full px-2 py-1 rounded text-xs outline-none ${isNight ? 'bg-night-card' : 'bg-white'}`}
                    />
                  ) : (
                    <div className="text-xs font-medium truncate flex items-center gap-1">
                      {s.pinned && <Pin size={10} className={isNight ? 'text-night-amber' : 'text-day-pink'} />}
                      {s.title}
                    </div>
                  )}
                  <div className="text-[10px] opacity-40 mt-1 flex justify-between">
                    <span>{s.messages.length} messages</span>
                    <span>{formatDate(s.updatedAt)}</span>
                  </div>
                </div>
                <div className="opacity-0 group-hover:opacity-100 flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => togglePinSession(s.id)} className="p-1 opacity-60 hover:opacity-100"><Pin size={12} /></button>
                  <button onClick={() => startRename(s.id, s.title)} className="p-1 opacity-60 hover:opacity-100"><Pencil size={12} /></button>
                  <button onClick={() => { if (confirm('删除这条对话？')) deleteSession(s.id) }} className="p-1 text-day-error hover:text-day-error dark:text-night-error/60 dark:hover:text-night-error"><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="p-3 border-t border-current/5 space-y-2">
        <button
          onClick={() => setSettingsOpen(true)}
          className={`w-full text-left px-3 py-2 rounded-xl text-xs ${isNight ? 'hover:bg-night-surface' : 'hover:bg-gray-50'}`}
        >
          <div className="font-medium">模型 / 人设 / 上下文</div>
          <div className="text-[10px] opacity-40 truncate mt-0.5">{activeProfile?.name || 'No provider'} · {settings.model}</div>
        </button>
      </div>
    </div>
  )

  const ModelPicker = () => (
    <AnimatePresence>
      {modelPickerOpen && (
        <>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModelPickerOpen(false)} className="fixed inset-0 z-30" />
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className={`absolute left-4 bottom-[112px] z-40 w-[min(420px,calc(100vw-2rem))] max-h-[55vh] overflow-y-auto rounded-2xl shadow-xl border p-2 ${isNight ? 'bg-night-surface border-night-border' : 'bg-white border-gray-100'}`}
          >
            <div className="px-3 py-2 text-xs opacity-50">切换模型</div>
            {settings.apiProfiles.map((profile) => {
              const enabled = profile.models.filter((m) => m.enabled)
              if (!enabled.length) return null
              return (
                <div key={profile.id} className="mb-2">
                  <div className="px-3 py-1 text-[10px] opacity-40 uppercase tracking-wide">{profile.name}</div>
                  {enabled.map((model) => {
                    const active = settings.activeProfileId === profile.id && settings.model === model.id
                    return (
                      <button
                        key={`${profile.id}-${model.id}`}
                        onClick={() => { setActiveModel(profile.id, model.id); setModelPickerOpen(false) }}
                        className={`w-full text-left px-3 py-2 rounded-xl text-xs ${active ? (isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white') : (isNight ? 'hover:bg-night-surface' : 'hover:bg-gray-50')}`}
                      >
                        <div className="font-medium truncate">{model.name || model.id}</div>
                        <div className="text-[10px] opacity-60 truncate">{model.id}</div>
                      </button>
                    )
                  })}
                </div>
              )
            })}
            {!enabledModels.length && <div className="px-3 py-6 text-xs opacity-40 text-center">还没有启用的模型</div>}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )

  return (
    <>
      <div className="flex h-full relative overflow-hidden">
        <div className="hidden lg:block h-full">
          <Sidebar />
        </div>

        <div className="flex flex-col h-full flex-1 min-w-0">
          {/* Desktop header: title + weather + city */}
          <div className="hidden md:flex px-6 py-3 items-center justify-between border-b border-current/5">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => setSessionDrawerOpen(true)} className={`lg:hidden p-2 rounded-xl ${isNight ? 'hover:bg-night-surface' : 'hover:bg-gray-100'}`}>
                <PanelLeft size={16} />
              </button>
              <h2 className="text-sm font-medium opacity-80 truncate">🐆 {activeSession?.title || '星星'}</h2>
              <span className="text-[10px] opacity-40 truncate hidden lg:inline">{activeProfile?.name} · {settings.model}</span>
              {cacheHit && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${isNight ? 'bg-night-amber/10 text-night-amber' : 'bg-day-lemon text-day-muted'}`}>
                  cache ↻ {lastAssistant?.cache_read_tokens}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {weatherChip}
              <button onClick={() => setSettingsOpen(true)} className={`p-2 rounded-xl transition ${isNight ? 'hover:bg-night-surface text-night-muted' : 'hover:bg-gray-100 text-day-muted'}`}>
                <Settings2 size={16} />
              </button>
            </div>
          </div>

          {/* Mobile floating buttons */}
          <div className="md:hidden absolute top-3 left-3 right-3 z-20 flex justify-between pointer-events-none">
            <button onClick={() => setSessionDrawerOpen(true)} className={`pointer-events-auto p-2 rounded-xl ${isNight ? 'bg-night-card/80 text-night-muted' : 'bg-white text-day-muted'} backdrop-blur-md`}>
              <PanelLeft size={16} />
            </button>
            <button onClick={() => setSettingsOpen(true)} className={`pointer-events-auto p-2 rounded-xl ${isNight ? 'bg-night-card/80 text-night-muted' : 'bg-white text-day-muted'} backdrop-blur-md`}>
              <Settings2 size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-40">
                <span className="text-4xl">🐆</span>
                <p className="text-sm">说点什么吧</p>
                <p className="text-[11px]">{activeProfile?.name || 'No provider'} · {settings.model}</p>
              </div>
            )}

            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[85%] sm:max-w-[80%] space-y-1 group/msg">
                    {msg.thinking && (
                      <button onClick={() => toggleThinking(msg.id)} className={`text-xs flex items-center gap-1 ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
                        <ChevronDown size={12} className={`transition-transform ${expandedThinking.has(msg.id) ? 'rotate-180' : ''}`} /> Thinking
                      </button>
                    )}
                    <AnimatePresence>
                      {msg.thinking && expandedThinking.has(msg.id) && (
                        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className={`text-xs p-2 rounded-lg overflow-hidden whitespace-pre-wrap ${isNight ? 'bg-night-surface text-night-muted' : 'bg-gray-50 text-day-muted'}`}>
                          {msg.thinking}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {msg.tool_calls && msg.tool_calls.length > 0 && (
                      <>
                        <button onClick={() => toggleTools(msg.id)} className={`text-xs flex items-center gap-1 ${isNight ? 'text-night-amber/70' : 'text-day-pink'}`}>
                          <ChevronDown size={12} className={`transition-transform ${expandedTools.has(msg.id) ? 'rotate-180' : ''}`} />
                          🔧 {msg.tool_calls.length} tool{msg.tool_calls.length > 1 ? 's' : ''}
                        </button>
                        <AnimatePresence>
                          {expandedTools.has(msg.id) && (
                            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                              <div className={`text-xs space-y-2 p-2.5 rounded-xl ${isNight ? 'bg-night-surface/80' : 'bg-gray-50'}`}>
                                {msg.tool_calls.map((tc: any, i: number) => (
                                  <div key={i} className={`p-2 rounded-lg ${isNight ? 'bg-night-card' : 'bg-white'}`}>
                                    <div className="flex items-center gap-1.5 mb-1">
                                      <span className={`font-medium ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>{tc.name}</span>
                                      <span className="opacity-30">→</span>
                                      <span className="opacity-50 truncate">{Object.entries(tc.input || {}).filter(([,v]) => v).map(([k,v]) => `${k}=${JSON.stringify(v)}`).join(', ').slice(0, 80)}</span>
                                    </div>
                                    <pre className={`whitespace-pre-wrap text-[10px] leading-relaxed max-h-40 overflow-y-auto ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>{typeof tc.result === 'string' ? tc.result.slice(0, 500) : JSON.stringify(tc.result, null, 2).slice(0, 500)}{(tc.result?.length || 0) > 500 ? '...' : ''}</pre>
                                  </div>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </>
                    )}

                    {msg.images && msg.images.length > 0 && (
                      <div className={`flex flex-wrap gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                        {msg.images.map((img, i) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={i} src={img} alt="" className="max-w-[200px] max-h-[200px] rounded-xl object-cover" />
                        ))}
                      </div>
                    )}

                    {msg.content && (
                      <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? (isNight ? 'bg-night-amber/20 text-night-text rounded-br-md' : 'bg-day-honey text-day-text rounded-br-md') : (isNight ? 'bg-night-surface text-night-text rounded-bl-md' : 'bg-white shadow-sm text-day-text rounded-bl-md')}`}>
                        <p className="whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    )}

                    <div className={`flex items-center gap-2 px-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <p className={`text-[10px] ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
                        {formatFullTs(msg.timestamp)}
                        {msg.modelId && <span className="opacity-50 ml-2 hidden sm:inline">{msg.modelId}</span>}
                        {msg.role === 'assistant' && msg.input_tokens && (
                          <span className="opacity-60 ml-2">↓{msg.input_tokens} ↑{msg.output_tokens}{msg.cache_read_tokens ? ` ↻${msg.cache_read_tokens}` : ''}</span>
                        )}
                      </p>
                      <div className={`flex gap-0.5 transition-opacity opacity-60 md:opacity-0 md:group-hover/msg:opacity-100`}>
                        {msg.role === 'assistant' && (
                          <button onClick={() => handleReroll(msg.id)} title="重新生成" className={`p-1 rounded hover:bg-current/10 ${isNight ? 'text-night-muted hover:text-night-amber' : 'text-day-muted hover:text-day-pink'}`}>
                            <RotateCcw size={11} />
                          </button>
                        )}
                        <button onClick={() => handleBranch(msg.id)} title="从这里分支" className={`p-1 rounded hover:bg-current/10 ${isNight ? 'text-night-muted hover:text-night-amber' : 'text-day-muted hover:text-day-pink'}`}>
                          <GitBranch size={11} />
                        </button>
                        <button onClick={() => { if (confirm('删除这条消息？')) deleteMessage(msg.id) }} title="删除" className="p-1 rounded hover:bg-current/10 text-day-error hover:text-day-error dark:text-night-error/70 dark:hover:text-night-error">
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {isLoading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                <div className={`px-4 py-3 rounded-2xl rounded-bl-md ${isNight ? 'bg-night-surface' : 'bg-white shadow-sm'}`}>
                  <div className="flex gap-1">
                    {[0, 1, 2].map((i) => (
                      <motion.div key={i} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} className={`w-1.5 h-1.5 rounded-full ${isNight ? 'bg-night-amber' : 'bg-day-pink'}`} />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className={`p-4 pt-2 border-t backdrop-blur-md ${isNight ? 'border-night-border bg-night-card/50' : 'border-day-border bg-white/50'} pb-[max(1rem,env(safe-area-inset-bottom))] relative`}>
            <ModelPicker />

            {/* Context window status */}
            {contextSlice.length > 0 && (
              <div className="flex items-center gap-2 mb-2 px-1">
                <div className={`h-1 flex-1 rounded-full overflow-hidden ${isNight ? 'bg-night-surface' : 'bg-gray-100'}`}>
                  <div
                    className={`h-full rounded-full transition-all ${isNight ? 'bg-night-amber/60' : 'bg-day-honey'}`}
                    style={{ width: `${contextPct}%` }}
                  />
                </div>
                <span className={`text-[10px] flex-shrink-0 ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
                  🪟 {contextSlice.length}/{settings.contextLength} · {formatDuration(windowDuration)} · ~{contextTokens > 1000 ? (contextTokens / 1000).toFixed(1) + 'K' : contextTokens} tok
                </span>
              </div>
            )}

            {/* Image previews */}
            {images.length > 0 && (
              <div className="flex gap-2 mb-2 px-1">
                {images.map((img, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img} alt="" className="w-14 h-14 rounded-lg object-cover" />
                    <button onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))} className="absolute -top-1.5 -right-1.5 bg-black/60 text-white rounded-full p-0.5">
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className={`flex items-end gap-2 px-3 py-2 rounded-2xl ${isNight ? 'bg-night-card' : 'bg-gray-50'}`}>
              <button
                onClick={() => setModelPickerOpen((v) => !v)}
                className={`max-w-[32%] sm:max-w-[200px] flex-shrink-0 px-2 py-2 rounded-xl text-[10px] text-left leading-tight ${isNight ? 'bg-night-surface hover:bg-night-surface/80' : 'bg-white hover:bg-gray-100'}`}
                title="切换模型"
              >
                <div className="truncate font-medium">{activeProfile?.name || 'No API'}</div>
                <div className="truncate opacity-50">{settings.model}</div>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = '' }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className={`p-2 rounded-xl flex-shrink-0 transition ${isNight ? 'text-night-muted hover:text-night-amber hover:bg-night-card' : 'text-day-muted hover:text-day-pink hover:bg-white'}`}
                title="发送图片"
              >
                <ImagePlus size={16} />
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="说点什么..."
                rows={1}
                enterKeyHint="send"
                className={`flex-1 resize-none bg-transparent outline-none text-sm py-1 max-h-40 ${isNight ? 'text-night-text placeholder:text-night-muted' : 'text-day-text placeholder:text-day-muted'}`}
              />
              <button onClick={handleSend} disabled={(!input.trim() && !images.length) || isLoading} className={`p-2 rounded-xl transition-all flex-shrink-0 ${(input.trim() || images.length) ? (isNight ? 'bg-night-amber text-night-bg hover:bg-night-amberGlow' : 'bg-day-pink text-white hover:bg-day-pinkDeep') : 'opacity-30 cursor-not-allowed'}`}>
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {sessionDrawerOpen && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSessionDrawerOpen(false)} className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden" />
            <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', damping: 30, stiffness: 280 }} className="fixed left-0 top-0 bottom-0 z-50 lg:hidden">
              <Sidebar mobile />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <ChatSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
