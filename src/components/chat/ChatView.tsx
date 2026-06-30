'use client'

import { useState, useRef, useEffect } from 'react'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, ChevronDown, Settings2, PanelLeft, Plus, Pin, Trash2, Pencil, Search, X } from 'lucide-react'
import {
  useChatStore,
  ChatMessage,
  getActiveProfile,
  getEnabledModels,
  getSortedSessions,
} from '@/lib/chatStore'
import { chat } from '@/lib/api'
import { ChatSettings } from './ChatSettings'

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
  } = useChatStore()
  const activeProfile = getActiveProfile(settings)
  const enabledModels = getEnabledModels(settings)
  const sessions = getSortedSessions(settings)
  const activeSession = settings.sessions.find((s) => s.id === settings.activeSessionId)

  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [sessionSearch, setSessionSearch] = useState('')
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [input])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const profile = getActiveProfile(settings)
    const model = settings.model
    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
      providerId: profile?.id,
      modelId: model,
    }
    addMessage(userMsg)
    setInput('')
    setIsLoading(true)

    try {
      const history = [...messages, userMsg]
      const slice = history.slice(-settings.contextLength)

      const data = await chat.send({
        messages: slice.map((m) => ({ role: m.role, content: m.content })),
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
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

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })

  const formatDate = (ts: number) => {
    const d = new Date(ts)
    const today = new Date()
    if (d.toDateString() === today.toDateString()) return formatTime(ts)
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

  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <div className={`h-full flex flex-col ${mobile ? 'w-[86vw] max-w-[340px]' : 'w-[300px]'} ${isNight ? 'bg-night-card border-night-border' : 'bg-white border-day-muted/10'} border-r`}>
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
                  ? isNight ? 'bg-night-amber/15 text-night-text' : 'bg-day-lemon text-day-text'
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
                      {s.pinned && <Pin size={10} className={isNight ? 'text-night-amber' : 'text-day-heart'} />}
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
                  <button onClick={() => { if (confirm('删除这条对话？')) deleteSession(s.id) }} className="p-1 text-red-500/60 hover:text-red-500"><Trash2 size={12} /></button>
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
            className={`absolute left-4 bottom-[92px] z-40 w-[min(420px,calc(100vw-2rem))] max-h-[55vh] overflow-y-auto rounded-2xl shadow-xl border p-2 ${isNight ? 'bg-night-card border-night-border' : 'bg-white border-gray-100'}`}
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
          <div className="hidden md:flex px-6 py-3 items-center justify-between border-b border-current/5">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => setSessionDrawerOpen(true)} className={`lg:hidden p-2 rounded-xl ${isNight ? 'hover:bg-night-surface' : 'hover:bg-gray-100'}`}>
                <PanelLeft size={16} />
              </button>
              <h2 className="text-sm font-medium opacity-80 truncate">{activeSession?.title || '对话'}</h2>
              <span className="text-[10px] opacity-40 truncate">{activeProfile?.name} · {settings.model}</span>
              {cacheHit && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${isNight ? 'bg-night-amber/10 text-night-amber' : 'bg-day-lemon text-day-pink'}`}>
                  cache ↻ {lastAssistant?.cache_read_tokens}
                </span>
              )}
            </div>
            <button onClick={() => setSettingsOpen(true)} className={`p-2 rounded-xl transition ${isNight ? 'hover:bg-night-surface text-night-muted' : 'hover:bg-gray-100 text-day-muted'}`}>
              <Settings2 size={16} />
            </button>
          </div>

          <div className="md:hidden absolute top-3 left-3 right-3 z-20 flex justify-between pointer-events-none">
            <button onClick={() => setSessionDrawerOpen(true)} className={`pointer-events-auto p-2 rounded-xl ${isNight ? 'bg-night-card/80 text-night-muted' : 'bg-white/80 text-day-muted'} backdrop-blur-md`}>
              <PanelLeft size={16} />
            </button>
            <button onClick={() => setSettingsOpen(true)} className={`pointer-events-auto p-2 rounded-xl ${isNight ? 'bg-night-card/80 text-night-muted' : 'bg-white/80 text-day-muted'} backdrop-blur-md`}>
              <Settings2 size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-40">
                <span className="text-4xl">🏠</span>
                <p className="text-sm">说点什么吧</p>
                <p className="text-[11px]">{activeProfile?.name || 'No provider'} · {settings.model}</p>
              </div>
            )}

            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className="max-w-[85%] sm:max-w-[80%] space-y-1">
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

                    <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${msg.role === 'user' ? (isNight ? 'bg-night-amber/20 text-night-text rounded-br-md' : 'bg-day-honey text-day-text rounded-br-md') : (isNight ? 'bg-night-surface text-night-text rounded-bl-md' : 'bg-white shadow-sm text-day-text rounded-bl-md')}`}>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>

                    <p className={`text-[10px] px-1 ${msg.role === 'user' ? 'text-right' : 'text-left'} ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
                      {formatTime(msg.timestamp)}
                      {msg.modelId && <span className="opacity-50 ml-2">{msg.modelId}</span>}
                      {msg.role === 'assistant' && msg.input_tokens && (
                        <span className="opacity-60 ml-2">↓{msg.input_tokens} ↑{msg.output_tokens}{msg.cache_read_tokens ? ` ↻${msg.cache_read_tokens}` : ''}</span>
                      )}
                    </p>
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

          <div className={`p-4 border-t backdrop-blur-md ${isNight ? 'border-night-border bg-night-card/50' : 'border-day-muted/10 bg-white/50'} pb-[max(1rem,env(safe-area-inset-bottom))] relative`}>
            <ModelPicker />
            <div className={`flex items-end gap-2 px-3 py-2 rounded-2xl ${isNight ? 'bg-night-surface' : 'bg-gray-50'}`}>
              <button
                onClick={() => setModelPickerOpen((v) => !v)}
                className={`max-w-[36%] sm:max-w-[220px] flex-shrink-0 px-2 py-2 rounded-xl text-[10px] text-left leading-tight ${isNight ? 'bg-night-card hover:bg-night-card/80' : 'bg-white hover:bg-gray-100'}`}
                title="切换模型"
              >
                <div className="truncate font-medium">{activeProfile?.name || 'No API'}</div>
                <div className="truncate opacity-50">{settings.model}</div>
              </button>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="说点什么..."
                rows={1}
                enterKeyHint="send"
                className={`flex-1 resize-none bg-transparent outline-none text-sm py-1 max-h-40 ${isNight ? 'text-night-text placeholder:text-night-muted' : 'text-day-text placeholder:text-day-muted'}`}
              />
              <button onClick={handleSend} disabled={!input.trim() || isLoading} className={`p-2 rounded-xl transition-all flex-shrink-0 ${input.trim() ? (isNight ? 'bg-night-amber text-night-bg hover:bg-night-amberGlow' : 'bg-day-pink text-white hover:bg-day-pink/80') : 'opacity-30 cursor-not-allowed'}`}>
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
