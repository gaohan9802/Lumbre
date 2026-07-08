'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send, ChevronDown, ChevronLeft, ChevronRight, Settings2, PanelLeft,
  Plus, Pin, Trash2, Pencil, Search, X, Copy, Check, RotateCcw, BookMarked,
} from 'lucide-react'
import {
  useChatStore, ChatMessage, MessageVersion, snapshotOfMessage,
  getActiveProfile, getEnabledModels, getSortedSessions, getTriggeredBookmarks,
} from '@/lib/chatStore'
import { chat } from '@/lib/api'
import { ChatSettings } from './ChatSettings'
import { ModelDialog } from './ModelDialog'
import { BookmarkDialog } from './BookmarkDialog'

/* ── helpers ────────────────────────────── */

const fmtFullTs = (ts: number) => {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const fmtShortDate = (ts: number) => {
  const d = new Date(ts)
  const today = new Date()
  if (d.toDateString() === today.toDateString())
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

/* ── confirm dialog ─────────────────────── */

function useConfirm() {
  const [state, setState] = useState<{ msg: string; resolve: (v: boolean) => void } | null>(null)
  const ask = useCallback((msg: string) => new Promise<boolean>((resolve) => setState({ msg, resolve })), [])
  const answer = useCallback((v: boolean) => { state?.resolve(v); setState(null) }, [state])
  return { confirmState: state, ask, answer }
}

/* ── main component ─────────────────────── */

export function ChatView() {
  const { theme } = useTheme()
  const n = theme === 'night'
  const {
    messages, settings,
    addMessage, updateMessage, createSession, setActiveSession,
    renameSession, deleteSession, togglePinSession, setActiveModel,
    deleteMessage, addMessageVersion, switchMessageVersion,
  } = useChatStore()
  const activeProfile = getActiveProfile(settings)
  const enabledModels = getEnabledModels(settings)
  const sessions = getSortedSessions(settings)
  const activeSession = settings.sessions.find((s) => s.id === settings.activeSessionId)

  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [streamThinking, setStreamThinking] = useState('')
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set())
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false)
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [sessionSearch, setSessionSearch] = useState('')
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [editingMsgText, setEditingMsgText] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [modelSearchText, setModelSearchText] = useState('')
  const [modelFilterProvider, setModelFilterProvider] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  const { confirmState, ask, answer } = useConfirm()

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading, streamText])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [input])

  /* ── send ────────────────────────────── */

  const doSend = async (sendMessages: { role: string; content: string }[], onDone: (data: any) => void) => {
    const profile = getActiveProfile(settings)
    const model = settings.model

    // Build bookmark injections
    const triggered = getTriggeredBookmarks(settings.bookmarks, messages)
    const startInjections = triggered.filter(b => b.position === 'start').map(b => b.content)
    const endInjections = triggered.filter(b => b.position === 'end').map(b => b.content)

    let systemPrompt = settings.systemPrompt || undefined
    if (startInjections.length || endInjections.length) {
      const prefix = startInjections.length ? '\n\n[书签提醒]\n' + startInjections.join('\n---\n') : ''
      const suffix = endInjections.length ? '\n\n[书签提醒]\n' + endInjections.join('\n---\n') : ''
      systemPrompt = (systemPrompt || '') + prefix + suffix
    }

    if (settings.streamEnabled) {
      // Streaming mode
      setStreamText('')
      setStreamThinking('')
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: sendMessages,
            system: systemPrompt,
            model,
            thinking_budget: settings.thinkingBudget,
            prompt_caching: settings.promptCaching,
            temperature: settings.temperature,
            stream: true,
            api_profile: profile ? {
              provider: profile.provider, baseUrl: profile.baseUrl,
              apiKey: profile.apiKey, modelId: model,
            } : undefined,
          }),
        })
        if (!res.ok) {
          const errText = await res.text()
          onDone({ content: `Error ${res.status}: ${errText.slice(0, 200)}`, error: true })
          return
        }
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let fullText = ''
        let fullThinking = ''
        let toolCalls: any[] = []
        let usage: any = {}

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() || ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6)
            if (raw === '[DONE]') continue
            try {
              const evt = JSON.parse(raw)
              if (evt.type === 'text') { fullText += evt.content; setStreamText(fullText) }
              else if (evt.type === 'thinking') { fullThinking += evt.content; setStreamThinking(fullThinking) }
              else if (evt.type === 'tool_call') { toolCalls.push(evt) }
              else if (evt.type === 'done') { usage = evt }
            } catch { /* ignore parse errors */ }
          }
        }
        onDone({
          content: fullText,
          thinking: fullThinking || undefined,
          tool_calls: toolCalls.length ? toolCalls : undefined,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          cache_read_tokens: usage.cache_read_tokens,
          cache_creation_tokens: usage.cache_creation_tokens,
        })
      } catch (err: any) {
        onDone({ content: err?.message || '连接失败了…', error: true })
      }
    } else {
      // Non-streaming
      try {
        const data = await chat.send({
          messages: sendMessages,
          system: systemPrompt,
          model,
          thinking_budget: settings.thinkingBudget,
          prompt_caching: settings.promptCaching,
          temperature: settings.temperature,
          api_profile: profile ? {
            provider: profile.provider, baseUrl: profile.baseUrl,
            apiKey: profile.apiKey, modelId: model,
          } : undefined,
        })
        onDone(data)
      } catch (err: any) {
        onDone({ content: err?.message || '连接失败了…', error: true })
      }
    }
  }

  const handleSend = async () => {
    if (!input.trim() || isLoading) return
    const profile = getActiveProfile(settings)
    const model = settings.model
    const now = Date.now()
    const userMsg: ChatMessage = {
      id: now.toString(),
      role: 'user',
      content: input.trim(),
      timestamp: now,
      providerId: profile?.id,
      modelId: model,
    }
    addMessage(userMsg)
    setInput('')
    setIsLoading(true)

    const history = [...messages, userMsg]
    const slice = history.slice(-settings.contextLength)
    // Include timestamp for AI to read
    const apiMessages = slice.map((m) => ({
      role: m.role,
      content: m.content,
    }))

    await doSend(apiMessages, (data) => {
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
      setIsLoading(false)
      setStreamText('')
      setStreamThinking('')
    })
  }

  /* ── retry ────────────────────────────── */

  const handleRetry = async (msg: ChatMessage) => {
    const ok = await ask(msg.role === 'assistant' ? '重新生成这条回复？' : '重新发送并生成回复？')
    if (!ok) return

    const profile = getActiveProfile(settings)
    const model = settings.model
    setIsLoading(true)

    if (msg.role === 'assistant') {
      // Re-generate: use messages up to (but not including) this assistant message
      const idx = messages.findIndex(m => m.id === msg.id)
      const slice = messages.slice(0, idx).slice(-settings.contextLength)
      const apiMessages = slice.map(m => ({ role: m.role, content: m.content }))

      await doSend(apiMessages, (data) => {
        const newVersion: MessageVersion = {
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
        }
        addMessageVersion(msg.id, newVersion)
        setIsLoading(false)
        setStreamText('')
        setStreamThinking('')
      })
    } else {
      // User retry: regenerate the AI response that follows
      const idx = messages.findIndex(m => m.id === msg.id)
      const nextMsg = messages[idx + 1]
      if (nextMsg && nextMsg.role === 'assistant') {
        const slice = messages.slice(0, idx + 1).slice(-settings.contextLength)
        const apiMessages = slice.map(m => ({ role: m.role, content: m.content }))

        await doSend(apiMessages, (data) => {
          const newVersion: MessageVersion = {
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
          }
          addMessageVersion(nextMsg.id, newVersion)
          setIsLoading(false)
          setStreamText('')
          setStreamThinking('')
        })
      } else {
        setIsLoading(false)
      }
    }
  }

  /* ── delete message ───────────────────── */

  const handleDeleteMsg = async (id: string) => {
    const ok = await ask('删除这条消息？')
    if (ok) deleteMessage(id)
  }

  /* ── copy ─────────────────────────────── */

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  /* ── edit user message ────────────────── */

  const startEditMsg = (msg: ChatMessage) => {
    setEditingMsgId(msg.id)
    setEditingMsgText(msg.content)
  }
  const finishEditMsg = () => {
    if (!editingMsgId) return
    const msg = messages.find(m => m.id === editingMsgId)
    if (msg && editingMsgText.trim() && editingMsgText !== msg.content) {
      const newVersion: MessageVersion = {
        content: editingMsgText.trim(),
        timestamp: Date.now(),
        providerId: msg.providerId,
        modelId: msg.modelId,
      }
      addMessageVersion(editingMsgId, newVersion)
    }
    setEditingMsgId(null)
    setEditingMsgText('')
  }

  /* ── key handling ─────────────────────── */

  const toggleThinking = (id: string) => {
    setExpandedThinking(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  const toggleTools = (id: string) => {
    setExpandedTools(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  const filteredSessions = sessions.filter(s =>
    !sessionSearch.trim() || s.title.toLowerCase().includes(sessionSearch.toLowerCase()),
  )

  const startRename = (id: string, title: string) => { setEditingSessionId(id); setEditingTitle(title) }
  const finishRename = () => { if (editingSessionId) renameSession(editingSessionId, editingTitle); setEditingSessionId(null); setEditingTitle('') }

  /* ── appearance ───────────────────────── */
  const ap = settings.appearance
  const bgStyle: React.CSSProperties = ap.bgImage ? {
    backgroundImage: `url(${ap.bgImage})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  } : {}
  const bgOverlayStyle: React.CSSProperties = ap.bgImage ? {
    backgroundColor: n ? `rgba(15,20,25,${1 - ap.bgOpacity})` : `rgba(255,255,255,${1 - ap.bgOpacity})`,
  } : {}

  const userBubbleStyle: React.CSSProperties = {
    backgroundColor: ap.userBubbleColor || (n ? 'rgba(61,53,36,1)' : 'rgba(247,232,181,1)'),
    opacity: ap.userBubbleOpacity,
  }
  const aiBubbleStyle: React.CSSProperties = {
    backgroundColor: ap.aiBubbleColor || (n ? 'rgba(36,48,64,1)' : 'rgba(255,255,255,1)'),
    opacity: ap.aiBubbleOpacity,
  }

  /* ── model picker ─────────────────────── */

  const providerNames = settings.apiProfiles.filter(p => p.models.some(m => m.enabled)).map(p => p.name)

  const filteredModels = enabledModels.filter(({ profile, model }) => {
    if (modelFilterProvider && profile.name !== modelFilterProvider) return false
    if (modelSearchText) {
      const q = modelSearchText.toLowerCase()
      return (model.name || '').toLowerCase().includes(q) || model.id.toLowerCase().includes(q) || profile.name.toLowerCase().includes(q)
    }
    return true
  })

  /* ── sidebar ──────────────────────────── */

  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => (
    <div className={`h-full flex flex-col ${mobile ? 'w-[86vw] max-w-[340px]' : 'w-[300px]'} ${n ? 'bg-night-card border-night-border' : 'bg-white border-day-muted/10'} border-r`}>
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
          className={`w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs ${n ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}
        >
          <Plus size={13} /> 新对话
        </button>
        <div className={`flex items-center gap-2 px-3 py-2 rounded-xl ${n ? 'bg-night-surface' : 'bg-gray-50'}`}>
          <Search size={13} className="opacity-40" />
          <input value={sessionSearch} onChange={(e) => setSessionSearch(e.target.value)} placeholder="搜索会话" className="bg-transparent outline-none text-xs flex-1" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {filteredSessions.map((s) => {
          const active = s.id === settings.activeSessionId
          return (
            <div key={s.id} onClick={() => { setActiveSession(s.id); if (mobile) setSessionDrawerOpen(false) }}
              className={`group p-3 rounded-xl cursor-pointer transition ${active ? (n ? 'bg-night-amber/15 text-night-text' : 'bg-day-lemon text-day-text') : (n ? 'hover:bg-night-surface' : 'hover:bg-gray-50')}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  {editingSessionId === s.id ? (
                    <input value={editingTitle} autoFocus onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={finishRename} onKeyDown={(e) => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') setEditingSessionId(null) }}
                      onClick={(e) => e.stopPropagation()} className={`w-full px-2 py-1 rounded text-xs outline-none ${n ? 'bg-night-card' : 'bg-white'}`} />
                  ) : (
                    <div className="text-xs font-medium truncate flex items-center gap-1">
                      {s.pinned && <Pin size={10} className={n ? 'text-night-amber' : 'text-day-heart'} />}
                      {s.title}
                    </div>
                  )}
                  <div className="text-[10px] opacity-40 mt-1 flex justify-between">
                    <span>{s.messages.length} messages</span>
                    <span>{fmtShortDate(s.updatedAt)}</span>
                  </div>
                </div>
                <div className="opacity-0 group-hover:opacity-100 flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => togglePinSession(s.id)} className="p-1 opacity-60 hover:opacity-100"><Pin size={12} /></button>
                  <button onClick={() => startRename(s.id, s.title)} className="p-1 opacity-60 hover:opacity-100"><Pencil size={12} /></button>
                  <button onClick={async () => { const ok = await ask('删除这条对话？'); if (ok) deleteSession(s.id) }} className="p-1 text-red-500/60 hover:text-red-500"><Trash2 size={12} /></button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {/* removed bottom "模型/人设/上下文" entry per requirement #3 */}
    </div>
  )

  /* ── render ───────────────────────────── */

  return (
    <>
      <div className="flex h-full relative overflow-hidden" style={bgStyle}>
        {/* background overlay for opacity */}
        {ap.bgImage && <div className="absolute inset-0 pointer-events-none z-0" style={bgOverlayStyle} />}

        <div className="hidden lg:block h-full relative z-10">
          <SidebarContent />
        </div>

        <div className="flex flex-col h-full flex-1 min-w-0 relative z-10">
          {/* desktop header */}
          <div className="hidden md:flex px-6 py-3 items-center justify-between border-b border-current/5">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => setSessionDrawerOpen(true)} className={`lg:hidden p-2 rounded-xl ${n ? 'hover:bg-night-surface' : 'hover:bg-gray-100'}`}>
                <PanelLeft size={16} />
              </button>
              <h2 className="text-sm font-medium opacity-80 truncate">{activeSession?.title || '对话'}</h2>
            </div>
            <button onClick={() => setSettingsOpen(true)} className={`p-2 rounded-xl transition ${n ? 'hover:bg-night-surface text-night-muted' : 'hover:bg-gray-100 text-day-muted'}`}>
              <Settings2 size={16} />
            </button>
          </div>

          {/* mobile header */}
          <div className="md:hidden flex justify-between items-center px-4 pt-3 pb-1">
            <button onClick={() => setSessionDrawerOpen(true)} className={`p-2 rounded-xl ${n ? 'bg-night-card/80 text-night-muted' : 'bg-white/80 text-day-muted'} backdrop-blur-md`}>
              <PanelLeft size={16} />
            </button>
            <button onClick={() => setSettingsOpen(true)} className={`p-2 rounded-xl ${n ? 'bg-night-card/80 text-night-muted' : 'bg-white/80 text-day-muted'} backdrop-blur-md`}>
              <Settings2 size={16} />
            </button>
          </div>

          {/* messages */}
          <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-40">
                <span className="text-4xl">🏠</span>
                <p className="text-sm">说点什么吧</p>
              </div>
            )}

            <AnimatePresence initial={false}>
              {messages.map((msg) => {
                const isUser = msg.role === 'user'
                const versions = msg.versions || []
                const vIdx = msg.versionIndex ?? 0
                const hasVersions = versions.length > 1
                const isEditing = editingMsgId === msg.id

                return (
                  <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div className="max-w-[85%] sm:max-w-[80%] space-y-1">
                      {/* wake indicator */}
                      {(msg as any)._wake && (
                        <div className={`flex items-center gap-1.5 text-[10px] px-1 mb-0.5 ${n ? 'text-night-amber/70' : 'text-day-pink/70'}`}>
                          <span>💓</span> <span>心跳唤醒</span>
                        </div>
                      )}

                      {/* timestamp */}
                      <p className={`text-[10px] px-1 ${isUser ? 'text-right' : 'text-left'} ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                        {fmtFullTs(msg.timestamp)}
                      </p>

                      {/* thinking - above bubble, collapsed */}
                      {msg.thinking && (
                        <>
                          <button onClick={() => toggleThinking(msg.id)} className={`text-xs flex items-center gap-1 max-w-full ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                            <ChevronDown size={12} className={`transition-transform flex-shrink-0 ${expandedThinking.has(msg.id) ? '' : '-rotate-90'}`} />
                            <span className="truncate">💭 {expandedThinking.has(msg.id) ? 'Thinking' : (msg.thinking!.slice(0, 50).replace(/\n/g, ' ') + (msg.thinking!.length > 50 ? '…' : ''))}</span>
                          </button>
                          <AnimatePresence>
                            {expandedThinking.has(msg.id) && (
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                className={`text-xs p-2 rounded-lg overflow-hidden whitespace-pre-wrap ${n ? 'bg-night-surface text-night-muted' : 'bg-gray-50 text-day-muted'}`}>
                                {msg.thinking}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </>
                      )}

                      {/* tool calls - above bubble, collapsed */}
                      {msg.tool_calls && msg.tool_calls.length > 0 && (
                        <>
                          <button onClick={() => toggleTools(msg.id)} className={`text-xs flex items-center gap-1 ${n ? 'text-night-amber/70' : 'text-day-pink/70'}`}>
                            <ChevronDown size={12} className={`transition-transform ${expandedTools.has(msg.id) ? '' : '-rotate-90'}`} />
                            🔧 {msg.tool_calls.map((tc: any) => tc.name).join(', ')}
                          </button>
                          <AnimatePresence>
                            {expandedTools.has(msg.id) && (
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                <div className={`text-xs space-y-1.5 p-2 rounded-xl ${n ? 'bg-night-surface/80' : 'bg-gray-50'}`}>
                                  {msg.tool_calls.map((tc: any, i: number) => (
                                    <div key={i} className={`p-2 rounded-lg ${n ? 'bg-night-card' : 'bg-white'}`}>
                                      <span className={`font-medium ${n ? 'text-night-amber' : 'text-day-pink'}`}>{tc.name}</span>
                                      <span className="opacity-40 ml-1.5 text-[10px]">
                                        {Object.entries(tc.input || {}).filter(([,v]) => v).map(([k,v]) => `${k}=${typeof v === 'string' ? v.slice(0,30) : JSON.stringify(v).slice(0,30)}`).join(', ')}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </>
                      )}

                      {/* bubble */}
                      {isEditing ? (
                        <div className={`rounded-2xl overflow-hidden ${isUser ? 'rounded-br-md' : 'rounded-bl-md'}`}>
                          <textarea value={editingMsgText} onChange={(e) => setEditingMsgText(e.target.value)}
                            className={`w-full p-3 text-sm outline-none resize-y ${n ? 'bg-night-surface text-night-text' : 'bg-gray-50 text-day-text'}`} rows={3} autoFocus />
                          <div className={`flex gap-2 justify-end px-3 py-2 ${n ? 'bg-night-surface' : 'bg-gray-50'}`}>
                            <button onClick={() => { setEditingMsgId(null); setEditingMsgText('') }} className="text-xs opacity-60">取消</button>
                            <button onClick={finishEditMsg} className={`text-xs font-medium ${n ? 'text-night-amber' : 'text-day-pink'}`}>保存</button>
                          </div>
                        </div>
                      ) : (
                        <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${isUser ? 'rounded-br-md' : 'rounded-bl-md'} ${!ap.userBubbleColor && !ap.aiBubbleColor ? (isUser ? (n ? 'bg-night-amber/20 text-night-text' : 'bg-day-honey text-day-text') : (n ? 'bg-night-surface text-night-text' : 'bg-white shadow-sm text-day-text')) : ''}`}
                          style={isUser ? (ap.userBubbleColor ? userBubbleStyle : {}) : (ap.aiBubbleColor ? aiBubbleStyle : {})}>
                          <p className="whitespace-pre-wrap">{msg.content}</p>
                        </div>
                      )}

                      {/* action buttons */}
                      <div className={`flex items-center gap-1 ${isUser ? 'justify-end' : 'justify-start'} opacity-40 hover:opacity-100 transition-opacity`}>
                        <button onClick={() => handleRetry(msg)} title="重试" className="p-1"><RotateCcw size={12} /></button>
                        <button onClick={() => handleDeleteMsg(msg.id)} title="删除" className="p-1"><Trash2 size={12} /></button>
                        <button onClick={() => handleCopy(msg.id, msg.content)} title="复制" className="p-1">
                          {copiedId === msg.id ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                        {isUser && <button onClick={() => startEditMsg(msg)} title="修改" className="p-1"><Pencil size={12} /></button>}
                      </div>

                      {/* version switcher */}
                      {hasVersions && (
                        <div className={`flex items-center gap-2 text-[10px] ${isUser ? 'justify-end' : 'justify-start'} ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                          <button disabled={vIdx <= 0} onClick={() => switchMessageVersion(msg.id, vIdx - 1)} className="p-0.5 disabled:opacity-20"><ChevronLeft size={11} /></button>
                          <span>{vIdx + 1}/{versions.length}</span>
                          <button disabled={vIdx >= versions.length - 1} onClick={() => switchMessageVersion(msg.id, vIdx + 1)} className="p-0.5 disabled:opacity-20"><ChevronRight size={11} /></button>
                        </div>
                      )}

                      {/* AI model + tokens */}
                      {!isUser && (msg.input_tokens != null || msg.modelId) && (
                        <div className={`text-[10px] px-1 flex flex-wrap gap-x-2 ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                          {msg.modelId && <span className="opacity-40">{msg.modelId}</span>}
                          {msg.input_tokens != null && (
                            <>
                              <span className="opacity-50" title="输入tokens">↑{msg.input_tokens}</span>
                              <span className="opacity-50" title="输出tokens">↓{msg.output_tokens || 0}</span>
                              {(msg.cache_read_tokens ?? 0) > 0 && <span className="opacity-60 text-green-500" title="缓存读取">↻{msg.cache_read_tokens}</span>}
                              {(msg.cache_creation_tokens ?? 0) > 0 && <span className="opacity-60 text-yellow-500" title="缓存写入">⊕{msg.cache_creation_tokens}</span>}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>

            {/* loading / streaming */}
            {isLoading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
                <div className="max-w-[85%] sm:max-w-[80%] space-y-1">
                  {streamThinking && (
                    <div className={`text-xs p-2 rounded-lg whitespace-pre-wrap ${n ? 'bg-night-surface text-night-muted' : 'bg-gray-50 text-day-muted'}`}>
                      {streamThinking}
                    </div>
                  )}
                  {streamText ? (
                    <div className={`px-4 py-3 rounded-2xl rounded-bl-md text-sm leading-relaxed ${n ? 'bg-night-surface text-night-text' : 'bg-white shadow-sm text-day-text'}`}>
                      <p className="whitespace-pre-wrap">{streamText}</p>
                    </div>
                  ) : (
                    <div className={`px-4 py-3 rounded-2xl rounded-bl-md ${n ? 'bg-night-surface' : 'bg-white shadow-sm'}`}>
                      <div className="flex gap-1">
                        {[0, 1, 2].map(i => (
                          <motion.div key={i} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                            className={`w-1.5 h-1.5 rounded-full ${n ? 'bg-night-amber' : 'bg-day-pink'}`} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* footer */}
          <div className={`p-4 border-t backdrop-blur-md ${n ? 'border-night-border bg-night-card/50' : 'border-day-muted/10 bg-white/50'} pb-[max(1rem,env(safe-area-inset-bottom))] relative`}>
            {/* total layers */}
            <div className={`text-[10px] mb-2 px-1 flex justify-between ${n ? 'text-night-muted' : 'text-day-muted'}`}>
              <span>共 {messages.length} 层</span>
              <div className="flex gap-2">
                <button onClick={() => setBookmarkDialogOpen(true)} className="opacity-60 hover:opacity-100 flex items-center gap-1" title="书签">
                  <BookMarked size={11} /> 书签{settings.bookmarks.length > 0 ? ` (${settings.bookmarks.length})` : ''}
                </button>
              </div>
            </div>

            {/* input area */}
            <div className={`flex items-end gap-2 px-3 py-2 rounded-2xl ${n ? 'bg-night-surface' : 'bg-gray-50'}`}>
              <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
                placeholder="说点什么..." rows={1} enterKeyHint="enter"
                className={`flex-1 resize-none bg-transparent outline-none text-sm py-1 max-h-40 ${n ? 'text-night-text placeholder:text-night-muted' : 'text-day-text placeholder:text-day-muted'}`} />
              <button onClick={handleSend} disabled={!input.trim() || isLoading}
                className={`p-2 rounded-xl transition-all flex-shrink-0 ${input.trim() ? (n ? 'bg-night-amber text-night-bg hover:bg-night-amberGlow' : 'bg-day-pink text-white hover:bg-day-pink/80') : 'opacity-30 cursor-not-allowed'}`}>
                <Send size={16} />
              </button>
            </div>

            {/* model selector chip */}
            <div className="flex items-center justify-between mt-2 px-1">
              <button onClick={() => setModelPickerOpen(true)}
                className={`max-w-[60%] text-left text-[10px] leading-tight truncate opacity-60 hover:opacity-100`} title="切换模型">
                <span className="font-medium">{activeProfile?.name || 'No API'}</span>
                <span className="opacity-50 ml-1">· {settings.model}</span>
              </button>
              <button onClick={() => setModelDialogOpen(true)} className={`text-[10px] opacity-50 hover:opacity-100`}>
                模型API管理
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── portals ────────────────────────── */}
      {mounted && createPortal(
        <>
          {/* session drawer */}
          <AnimatePresence>
            {sessionDrawerOpen && (
              <>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSessionDrawerOpen(false)} className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm lg:hidden" />
                <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', damping: 30, stiffness: 280 }} className="fixed left-0 top-0 bottom-0 z-[61] lg:hidden">
                  <SidebarContent mobile />
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* model picker bottom sheet */}
          <AnimatePresence>
            {modelPickerOpen && (
              <>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setModelPickerOpen(false)} className="fixed inset-0 z-[60] bg-black/20" />
                <motion.div
                  initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
                  transition={{ type: 'spring', damping: 30, stiffness: 280 }}
                  className={`fixed bottom-0 left-0 right-0 z-[61] max-h-[65dvh] rounded-t-2xl shadow-2xl flex flex-col ${n ? 'bg-night-card text-night-text' : 'bg-[#faf9f5] text-day-text'}`}>
                  {/* drag handle */}
                  <div className="flex justify-center pt-2 pb-1"><div className={`w-10 h-1 rounded-full ${n ? 'bg-night-border' : 'bg-gray-300'}`} /></div>
                  {/* search */}
                  <div className="px-4 pb-2">
                    <div className={`flex items-center gap-2 px-3 py-2.5 rounded-xl ${n ? 'bg-night-surface' : 'bg-gray-50'}`}>
                      <Search size={14} className="opacity-40" />
                      <input value={modelSearchText} onChange={(e) => setModelSearchText(e.target.value)} placeholder="搜索模型…"
                        className="bg-transparent outline-none text-sm flex-1" autoFocus />
                    </div>
                  </div>
                  {/* model list */}
                  <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-1">
                    {filteredModels.map(({ profile, model }) => {
                      const active = settings.activeProfileId === profile.id && settings.model === model.id
                      return (
                        <button key={`${profile.id}-${model.id}`}
                          onClick={() => { setActiveModel(profile.id, model.id); setModelPickerOpen(false); setModelSearchText('') }}
                          className={`w-full text-left px-3 py-2.5 rounded-xl ${active ? (n ? 'bg-night-amber/15' : 'bg-day-lemon') : (n ? 'hover:bg-night-surface' : 'hover:bg-gray-50')}`}>
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{profile.name} · {model.name || model.id}</div>
                              <div className="text-[10px] opacity-40 truncate">{profile.name} · {model.id}</div>
                            </div>
                            {active && <Check size={16} className={`flex-shrink-0 ml-2 ${n ? 'text-night-amber' : 'text-day-pink'}`} />}
                          </div>
                        </button>
                      )
                    })}
                    {!filteredModels.length && <div className="text-center text-xs opacity-40 py-8">没有匹配的模型</div>}
                  </div>
                  {/* provider tabs */}
                  <div className={`flex gap-1 px-4 py-3 border-t overflow-x-auto pb-[max(0.75rem,env(safe-area-inset-bottom))] ${n ? 'border-night-border' : 'border-gray-200'}`}>
                    <button onClick={() => setModelFilterProvider(null)}
                      className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${!modelFilterProvider ? (n ? 'bg-night-amber/20 text-night-amber' : 'bg-day-lemon text-day-text font-medium') : 'opacity-60'}`}>全部</button>
                    {providerNames.map(name => (
                      <button key={name} onClick={() => setModelFilterProvider(modelFilterProvider === name ? null : name)}
                        className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${modelFilterProvider === name ? (n ? 'bg-night-amber/20 text-night-amber' : 'bg-day-lemon text-day-text font-medium') : 'opacity-60'}`}>{name}</button>
                    ))}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* confirm dialog */}
          <AnimatePresence>
            {confirmState && (
              <>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm" onClick={() => answer(false)} />
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                  className={`fixed z-[71] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(340px,calc(100vw-3rem))] rounded-2xl shadow-2xl p-6 ${n ? 'bg-night-card text-night-text' : 'bg-white text-day-text'}`}>
                  <p className="text-sm mb-6">{confirmState.msg}</p>
                  <div className="flex justify-end gap-3">
                    <button onClick={() => answer(false)} className="px-4 py-2 text-sm opacity-60 hover:opacity-100">取消</button>
                    <button onClick={() => answer(true)} className={`px-4 py-2 text-sm font-medium rounded-lg ${n ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}>确认</button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* settings / model / bookmark dialogs */}
          <ChatSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} onConfirm={async (msg, fn) => { const ok = await ask(msg); if (ok) fn() }} />
          <ModelDialog open={modelDialogOpen} onClose={() => setModelDialogOpen(false)} />
          <BookmarkDialog open={bookmarkDialogOpen} onClose={() => setBookmarkDialogOpen(false)} />
        </>,
        document.body,
      )}


    </>
  )
}
