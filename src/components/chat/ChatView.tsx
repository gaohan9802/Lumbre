'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send, ChevronDown, ChevronLeft, ChevronRight, Settings2, PanelLeft,
  Plus, Pin, Trash2, Pencil, Search, X, Copy, Check, RotateCcw, BookMarked, ImagePlus, Clock3,
} from 'lucide-react'
import {
  useChatStore, ChatMessage, MessageVersion, ContentBlock, snapshotOfMessage,
  getActiveProfile, getEnabledModels, getSortedSessions, getTriggeredBookmarks,
} from '@/lib/chatStore'
import { photos as photosApi } from '@/lib/api'
import { ChatSettings } from './ChatSettings'
import { ModelDialog } from './ModelDialog'
import { BookmarkDialog } from './BookmarkDialog'
import { TimelineTimerModal, TimelineCurrent } from '@/components/timeline/TimelineTimerModal'
import { SyncBadge } from '@/components/layout/SyncBadge'
import { MarkdownText } from './MarkdownText'

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

/* ── stable context window (cache-friendly) ──
 * 每轮 slice(-N) 会让消息数组的头部逐条前移，导致 Anthropic/OpenAI 的
 * 前缀缓存整段失效（缓存靠字节级前缀匹配）。这里把窗口起点量化到 STEP 的
 * 整数倍，窗口只在每 STEP 轮跳一次，其余轮次前缀完全稳定 → 命中缓存。 */
function stableSlice<T>(arr: T[], cap: number): T[] {
  const c = Math.max(4, cap || 30)
  if (arr.length <= c) return arr
  const STEP = Math.max(10, Math.floor(c / 3))
  const start = Math.floor((arr.length - c) / STEP) * STEP
  return arr.slice(start)
}

/* ── image compression ──────────────────────
 * 手机原图常是 HEIC/超大 JPEG，直接塞进 vision 请求会因格式不支持或超过
 * 5MB 上限被上游拒绝 → 回复被截断/为空。统一压成 ≤1568px 的 JPEG。 */
function compressImage(dataUrl: string, maxDim = 1568, quality = 0.85): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height)
          width = Math.round(width * scale)
          height = Math.round(height * scale)
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(dataUrl)
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    } catch { resolve(dataUrl) }
  })
}

/* ── confirm dialog ─────────────────────── */

function useConfirm() {
  const [state, setState] = useState<{ msg: string; resolve: (v: boolean) => void } | null>(null)
  const ask = useCallback((msg: string) => new Promise<boolean>((resolve) => setState({ msg, resolve })), [])
  const answer = useCallback((v: boolean) => { state?.resolve(v); setState(null) }, [state])
  return { confirmState: state, ask, answer }
}

function hexToRgba(hex: string, alpha: number) {
  const raw = hex.replace('#', '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return hex
  const value = parseInt(raw, 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${Math.max(0, Math.min(1, alpha))})`
}

function bubbleTextColor(hex: string, alpha: number, night: boolean) {
  const raw = hex.replace('#', '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return night ? '#f3e7dc' : '#4a3428'
  const bg = night ? [15, 20, 25] : [255, 249, 245]
  const a = Math.max(0, Math.min(1, alpha))
  const rgb = [0, 2, 4].map((i, index) => {
    const channel = parseInt(raw.slice(i, i + 2), 16)
    return (channel * a + bg[index] * (1 - a)) / 255
  })
  const linear = rgb.map((c) => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  // Light bubbles use a soft deep brown instead of harsh pure black.
  return luminance > 0.38 ? '#4a3428' : '#f3e7dc'
}

/* ── main component ─────────────────────── */

export interface ChatViewProps {
  embedded?: boolean
  contextInjection?: string
  title?: string
  inputPlaceholder?: string
  onTurn?: (role: 'user' | 'assistant', content: string) => void
}

export function ChatView({ embedded = false, contextInjection = '', title, inputPlaceholder = '说点什么...', onTurn }: ChatViewProps = {}) {
  const { theme } = useTheme()
  const n = theme === 'night'
  const {
    messages, settings,
    addMessage, updateMessage, createSession, setActiveSession,
    renameSession, deleteSession, togglePinSession, setActiveModel,
    deleteMessage, addMessageVersion, switchMessageVersion, deleteMessageVersion, continueSession,
  } = useChatStore()
  const activeProfile = getActiveProfile(settings)
  const enabledModels = getEnabledModels(settings)
  const sessions = getSortedSessions(settings)
  const activeSession = settings.sessions.find((s) => s.id === settings.activeSessionId)

  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [streamThinking, setStreamThinking] = useState('')
  const [streamBlocks, setStreamBlocks] = useState<ContentBlock[]>([])
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set())
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [bookmarkDialogOpen, setBookmarkDialogOpen] = useState(false)
  const [timelineOpen, setTimelineOpen] = useState(false)
  const [timelineCurrent, setTimelineCurrent] = useState<TimelineCurrent | null>(null)
  const [timelineNow, setTimelineNow] = useState(Date.now())
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
  const imgInputRef = useRef<HTMLInputElement>(null)
  const [uploadingImg, setUploadingImg] = useState(false)
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickBottomRef = useRef(true)

  useEffect(() => { setMounted(true) }, [])
  const refreshTimelineCurrent = useCallback(async () => {
    try { const r = await fetch('/api/timeline', { cache: 'no-store' }); const d = await r.json(); setTimelineCurrent(d.current || null) } catch {}
  }, [])
  useEffect(() => { refreshTimelineCurrent(); const t = setInterval(refreshTimelineCurrent, 30000); return () => clearInterval(t) }, [refreshTimelineCurrent])
  useEffect(() => { const t = setInterval(() => setTimelineNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const timelineElapsed = timelineCurrent ? Math.max(0, Math.floor((timelineNow - new Date(timelineCurrent.start_at).getTime()) / 1000)) : 0
  const timelineElapsedText = `${String(Math.floor(timelineElapsed / 3600)).padStart(2, '0')}:${String(Math.floor((timelineElapsed % 3600) / 60)).padStart(2, '0')}:${String(timelineElapsed % 60).padStart(2, '0')}`

  // Lazy-load: only render the most recent messages to keep the window snappy.
  const PAGE = 50
  const [visibleCount, setVisibleCount] = useState(PAGE)
  useEffect(() => { setVisibleCount(PAGE) }, [settings.activeSessionId])
  const hiddenCount = Math.max(0, messages.length - visibleCount)
  const visibleMessages = hiddenCount > 0 ? messages.slice(-visibleCount) : messages

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight
    stickBottomRef.current = dist < 80
  }

  useEffect(() => {
    if (stickBottomRef.current)
      messagesEndRef.current?.scrollIntoView({ behavior: streamText ? 'auto' : 'smooth' })
  }, [messages, isLoading, streamText])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [input])

  const [photoPrompt, setPhotoPrompt] = useState<{ dataUrl: string } | null>(null)

  const handleUploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploadingImg(true)
    const reader = new FileReader()
    reader.onload = async () => {
      const raw = reader.result as string
      const dataUrl = await compressImage(raw)
      // Show prompt asking if user wants to save to photo wall
      setPhotoPrompt({ dataUrl })
      setUploadingImg(false)
    }
    reader.onerror = () => setUploadingImg(false)
    reader.readAsDataURL(file)
  }

  const handlePhotoPromptChoice = async (choice: 'public' | 'locked' | 'no') => {
    if (!photoPrompt) return
    const { dataUrl } = photoPrompt
    setPhotoPrompt(null)
    let ref = dataUrl
    if (choice !== 'no') {
      try {
        const r = await photosApi.write('fire', dataUrl, '', 'chat', choice === 'locked')
        if (r?.id) ref = `/api/photos/raw/${r.id}`
      } catch {}
    }
    setPendingImages((prev) => [...prev, ref])
  }

  /* ── send ────────────────────────────── */

  const doSend = async (sendMessages: { role: string; content: string; images?: string[] }[], onDone: (data: any) => void) => {
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
    const readingInjection = contextInjection.trim()
    const statusInjection = timelineCurrent ? `[小火当前状态]\n正在做：${timelineCurrent.title}\n已持续：${Math.max(1, Math.floor((Date.now() - new Date(timelineCurrent.start_at).getTime()) / 60000))}分钟${timelineCurrent.tags?.length ? `\n标签：${timelineCurrent.tags.join('、')}` : ''}${timelineCurrent.note ? `\n开始备注：${timelineCurrent.note}` : ''}` : ''
    const bookmarkInjections = [readingInjection, statusInjection].filter(Boolean).join('\n\n')

    // Always stream the transport. A non-streaming /api/chat returns zero bytes
    // until the whole tool loop finishes (30-90s), which iOS Safari / mobile
    // networks silently drop as an idle connection -> fetch hangs, no reply, no
    // error (desktop tolerates it, mobile doesn't). Streaming keeps bytes
    // flowing so the connection stays alive on mobile. `live` only controls
    // whether the UI renders progressively; when off we just show loading dots.
    const live = settings.streamEnabled
    setStreamText('')
    setStreamThinking('')
    setStreamBlocks([])
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
          bookmark_injections: bookmarkInjections,
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
      let contentBlocks: ContentBlock[] = []
      let usage: any = {}

      // Keep the exact event order from the tool loop. Text/thinking chunks are
      // merged only while they are adjacent; a tool call closes the current
      // block, so the next model text stays after that tool in the saved reply.
      const appendContentBlock = (block: ContentBlock) => {
        const last = contentBlocks[contentBlocks.length - 1]
        if ((block.type === 'text' || block.type === 'thinking') &&
            last?.type === block.type && block.content) {
          last.content = (last.content || '') + block.content
        } else {
          contentBlocks.push(block)
        }
        if (live) setStreamBlocks(contentBlocks.map((item) => ({ ...item })))
      }

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
            if (evt.type === 'text') {
              fullText += evt.content
              appendContentBlock({ type: 'text', content: evt.content })
              if (live) setStreamText(fullText)
            } else if (evt.type === 'thinking') {
              fullThinking += evt.content
              appendContentBlock({ type: 'thinking', content: evt.content })
              if (live) setStreamThinking(fullThinking)
            } else if (evt.type === 'tool_call') {
              toolCalls.push(evt)
              appendContentBlock({ type: 'tool_call', name: evt.name, input: evt.input, result: evt.result })
            } else if (evt.type === 'error') {
              const errorText = (fullText ? '\n\n' : '') + '⚠️ ' + (evt.content || '出错了')
              fullText += errorText
              appendContentBlock({ type: 'text', content: errorText })
              if (live) setStreamText(fullText)
            } else if (evt.type === 'done') { usage = evt }
          } catch { /* ignore parse errors (incl. keepalive comments) */ }
        }
      }
      onDone({
        content: fullText,
        thinking: fullThinking || undefined,
        tool_calls: toolCalls.length ? toolCalls : undefined,
        content_blocks: contentBlocks.length ? contentBlocks : undefined,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_tokens: usage.cache_read_tokens,
        cache_creation_tokens: usage.cache_creation_tokens,
      })
    } catch (err: any) {
      onDone({ content: err?.message || '连接失败了…', error: true })
    }
  }

  const handleSend = async () => {
    if ((!input.trim() && pendingImages.length === 0) || isLoading) return
    const profile = getActiveProfile(settings)
    const model = settings.model
    const now = Date.now()
    const userMsg: ChatMessage = {
      id: now.toString(),
      role: 'user',
      content: input.trim(),
      timestamp: now,
      images: pendingImages.length ? pendingImages : undefined,
      providerId: profile?.id,
      modelId: model,
    }
    stickBottomRef.current = true
    addMessage(userMsg)
    onTurn?.('user', userMsg.content)
    setInput('')
    setPendingImages([])
    setIsLoading(true)

    const history = [...messages, userMsg]
    const slice = stableSlice(history, settings.contextLength)
    // Include timestamp + any attached images for AI to read
    // Include tool call summaries in assistant messages so AI knows what it called
    const apiMessages = slice.map((m) => {
      let msgContent = m.content
      if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
        const summary = m.tool_calls.map((tc: any) =>
          `[调用了${tc.name}(${JSON.stringify(tc.input).slice(0, 100)}) → ${(tc.result || '').slice(0, 150)}]`
        ).join('\n')
        msgContent = (msgContent || '') + '\n' + summary
      }
      return { role: m.role, content: msgContent, images: m.images }
    })

    await doSend(apiMessages, (data) => {
      const assistantContent = data.content || data.error || '...'
      addMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now(),
        thinking: data.thinking,
        input_tokens: data.input_tokens,
        output_tokens: data.output_tokens,
        cache_read_tokens: data.cache_read_tokens,
        cache_creation_tokens: data.cache_creation_tokens,
        tool_calls: data.tool_calls,
        content_blocks: data.content_blocks,
        providerId: profile?.id,
        modelId: model,
      })
      onTurn?.('assistant', assistantContent)
      setIsLoading(false)
      setStreamText('')
      setStreamThinking('')
      setStreamBlocks([])
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
      const slice = stableSlice(messages.slice(0, idx), settings.contextLength)
      const apiMessages = slice.map(m => ({ role: m.role, content: m.content, images: m.images }))

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
          content_blocks: data.content_blocks,
          providerId: profile?.id,
          modelId: model,
        }
        addMessageVersion(msg.id, newVersion)
        setIsLoading(false)
        setStreamText('')
        setStreamThinking('')
        setStreamBlocks([])
      })
    } else {
      // User retry: regenerate the AI response that follows
      const idx = messages.findIndex(m => m.id === msg.id)
      const nextMsg = messages[idx + 1]
      if (nextMsg && nextMsg.role === 'assistant') {
        const slice = stableSlice(messages.slice(0, idx + 1), settings.contextLength)
        const apiMessages = slice.map(m => ({ role: m.role, content: m.content, images: m.images }))

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
            content_blocks: data.content_blocks,
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

  /* ── delete with options ───────────────── */
  const [deleteMenuId, setDeleteMenuId] = useState<string | null>(null)
  const handleDeleteMsg = (id: string) => { setDeleteMenuId(deleteMenuId === id ? null : id) }
  const doDeleteVersion = (msg: ChatMessage) => {
    const versions = msg.versions || []
    if (versions.length > 1) deleteMessageVersion(msg.id, msg.versionIndex ?? versions.length - 1)
    else deleteMessage(msg.id)
    setDeleteMenuId(null)
  }
  const doDeleteAllVersions = (id: string) => { deleteMessage(id); setDeleteMenuId(null) }

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

  // Theme-aware bubble colors — day and night are configured independently.
  const uColor = n ? ap.userBubbleColorNight : ap.userBubbleColor
  const uOpacity = n ? ap.userBubbleOpacityNight : ap.userBubbleOpacity
  const aColor = n ? ap.aiBubbleColorNight : ap.aiBubbleColor
  const aOpacity = n ? ap.aiBubbleOpacityNight : ap.aiBubbleOpacity
  const userBubbleStyle: React.CSSProperties = {
    backgroundColor: uColor ? hexToRgba(uColor, uOpacity) : (n ? 'rgba(61,53,36,1)' : 'rgba(247,232,181,1)'),
    color: uColor ? bubbleTextColor(uColor, uOpacity, n) : undefined,
  }
  const aiBubbleStyle: React.CSSProperties = {
    backgroundColor: aColor ? hexToRgba(aColor, aOpacity) : (n ? 'rgba(36,48,64,1)' : 'rgba(255,255,255,1)'),
    color: aColor ? bubbleTextColor(aColor, aOpacity, n) : undefined,
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
                      onBlur={finishRename} onKeyDown={(e) => { if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) finishRename(); if (e.key === 'Escape') setEditingSessionId(null) }}
                      onClick={(e) => e.stopPropagation()} className={`w-full px-2 py-1 rounded text-xs outline-none ${n ? 'bg-night-card' : 'bg-white'}`} />
                  ) : (
                    <div className="text-xs font-medium truncate flex items-center gap-1">
                      {s.pinned && <Pin size={10} className={n ? 'text-night-amber' : 'text-day-heart'} />}
                      {s.title}
                    </div>
                  )}
                  <div className="text-[10px] opacity-40 mt-1 flex justify-between">
                    <span>{s.messageCount || s.messages.length} messages</span>
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
    </div>
  )

  /* ── render ───────────────────────────── */

  return (
    <>
      <div className="flex h-full relative overflow-hidden" style={bgStyle}>
        {/* background overlay for opacity */}
        {ap.bgImage && <div className="absolute inset-0 pointer-events-none z-0" style={bgOverlayStyle} />}

        {!embedded && <div className="hidden lg:block h-full relative z-10">
          <SidebarContent />
        </div>}

        <div className="flex flex-col h-full flex-1 min-w-0 relative z-10">
          {/* desktop header */}
          {!embedded && <div className="hidden md:flex px-6 py-3 items-center justify-between border-b border-current/5">
            <div className="flex items-center gap-3 min-w-0">
              <button onClick={() => setSessionDrawerOpen(true)} className={`lg:hidden p-2 rounded-xl ${n ? 'hover:bg-night-surface' : 'hover:bg-gray-100'}`}>
                <PanelLeft size={16} />
              </button>
              <h2 className="text-sm font-medium opacity-80 truncate">{title || activeSession?.title || '对话'}</h2>
            </div>
            <div className="flex items-center gap-3"><SyncBadge /><button onClick={() => setSettingsOpen(true)} className={`p-2 rounded-xl transition ${n ? 'hover:bg-night-surface text-night-muted' : 'hover:bg-gray-100 text-day-muted'}`}>
              <Settings2 size={16} />
            </button></div>
          </div>}

          {/* mobile header */}
          {!embedded && <div className="md:hidden flex justify-between items-center px-4 pt-3 pb-1">
            <button onClick={() => setSessionDrawerOpen(true)} className={`p-2 rounded-xl ${n ? 'bg-night-card/80 text-night-muted' : 'bg-white/80 text-day-muted'} backdrop-blur-md`}>
              <PanelLeft size={16} />
            </button>
            <button onClick={() => setSettingsOpen(true)} className={`p-2 rounded-xl ${n ? 'bg-night-card/80 text-night-muted' : 'bg-white/80 text-day-muted'} backdrop-blur-md`}>
              <Settings2 size={16} />
            </button>
          </div>}

          {/* messages */}
          <div ref={scrollRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 py-6 space-y-4" onClick={() => deleteMenuId && setDeleteMenuId(null)}>
            {messages.length === 0 && (
              <div className="flex items-center justify-center h-full text-center opacity-40">
                <span className="text-4xl" aria-label="等待对话">🐆</span>
              </div>
            )}

            {hiddenCount > 0 && (
              <div className="flex justify-center pb-2">
                <button onClick={() => setVisibleCount((c) => c + PAGE)}
                  className={`text-[11px] px-3 py-1.5 rounded-full opacity-60 hover:opacity-100 ${n ? 'bg-night-surface' : 'bg-gray-100'}`}>
                  加载更早的 {Math.min(PAGE, hiddenCount)} 条（还有 {hiddenCount} 条）
                </button>
              </div>
            )}

            <AnimatePresence initial={false}>
              {visibleMessages.map((msg) => {
                const isUser = msg.role === 'user'
                const versions = msg.versions || []
                const vIdx = msg.versionIndex ?? 0
                const hasVersions = versions.length > 1
                const isEditing = editingMsgId === msg.id

                return (
                  <motion.div key={msg.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex">
                    <div className="w-full space-y-1">
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

                      {/* Inline content blocks — interleaved thinking/tool/text */}
                      {!isUser && msg.content_blocks && msg.content_blocks.length > 0 ? (
                        <>
                          {msg.content_blocks.map((block: ContentBlock, bi: number) => {
                            const blockKey = `${msg.id}-b${bi}`
                            if (block.type === 'thinking' && block.content) {
                              const isExp = expandedThinking.has(blockKey)
                              return (
                                <div key={blockKey}>
                                  <button onClick={() => toggleThinking(blockKey)} className={`text-xs flex items-center gap-1 max-w-full ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                                    <ChevronDown size={12} className={`transition-transform flex-shrink-0 ${isExp ? '' : '-rotate-90'}`} />
                                    <span className="truncate">💭星星的小算盘</span>
                                  </button>
                                  <AnimatePresence>
                                    {isExp && (
                                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                        className={`text-[13px] p-2 rounded-lg overflow-hidden whitespace-pre-wrap ${n ? 'bg-night-surface text-night-muted' : 'bg-gray-50 text-day-muted'}`}>
                                        {block.content}
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              )
                            }
                            if (block.type === 'tool_call' && block.name) {
                              const isExp = expandedTools.has(blockKey)
                              return (
                                <div key={blockKey} className={`w-fit max-w-[87%] mr-auto rounded-xl border ${n ? 'border-night-border bg-night-surface/40' : 'border-gray-200 bg-gray-50/60'}`}>
                                  <button onClick={() => toggleTools(blockKey)} className={`w-full flex items-center gap-2 px-3 py-2 text-xs ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                                    <span className={`${n ? 'text-night-amber' : 'text-day-pink'}`}>🔧</span>
                                    <span>调用工具: <span className={`font-medium ${n ? 'text-night-amber' : 'text-day-pink'}`}>{block.name}</span></span>
                                    <ChevronDown size={12} className={`ml-auto transition-transform flex-shrink-0 ${isExp ? '' : '-rotate-90'}`} />
                                  </button>
                                  <AnimatePresence>
                                    {isExp && (
                                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                        <div className={`px-3 pb-2 text-xs space-y-1.5`}>
                                          {block.input && Object.keys(block.input).length > 0 && (
                                            <pre className={`text-[10px] leading-relaxed whitespace-pre-wrap break-all p-1.5 rounded ${n ? 'bg-night-card text-night-muted' : 'bg-white text-day-muted'}`}>
                                              {JSON.stringify(block.input, null, 2)}
                                            </pre>
                                          )}
                                          {block.result && (
                                            <div className={`pt-1 border-t ${n ? 'border-night-border' : 'border-gray-200'}`}>
                                              <span className="text-[10px] opacity-40 block mb-1">返回结果</span>
                                              <pre className={`text-[10px] leading-relaxed whitespace-pre-wrap break-all p-1.5 rounded max-h-[200px] overflow-y-auto ${n ? 'bg-night-card text-night-muted' : 'bg-white text-day-muted'}`}>
                                                {block.result}
                                              </pre>
                                            </div>
                                          )}
                                        </div>
                                      </motion.div>
                                    )}
                                  </AnimatePresence>
                                </div>
                              )
                            }
                            if (block.type === 'text' && typeof block.content === 'string' && block.content.trim()) {
                              return (
                                <div key={blockKey} className={`block w-fit max-w-[87%] mr-auto break-words px-4 py-3 rounded-2xl rounded-bl-md text-[14px] leading-relaxed backdrop-blur-[2px] ${!aColor ? (n ? 'bg-night-surface text-night-text' : 'bg-white shadow-sm text-day-text') : ''}`}
                                  style={aColor ? aiBubbleStyle : {}}>
                                  {msg.images && bi === 0 && msg.images.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                                      {msg.images.map((src: string, ii: number) => (
                                        <img key={ii} src={src} alt="" className="max-w-[180px] max-h-[180px] rounded-lg object-cover" />
                                      ))}
                                    </div>
                                  )}
                                  <MarkdownText content={block.content} />
                                </div>
                              )
                            }
                            return null
                          })}
                        </>
                      ) : (
                        <>
                          {/* Legacy: thinking above bubble */}
                          {msg.thinking && (
                            <>
                              <button onClick={() => toggleThinking(msg.id)} className={`text-xs flex items-center gap-1 max-w-full ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                                <ChevronDown size={12} className={`transition-transform flex-shrink-0 ${expandedThinking.has(msg.id) ? '' : '-rotate-90'}`} />
                                <span className="truncate">💭星星的小算盘</span>
                              </button>
                              <AnimatePresence>
                                {expandedThinking.has(msg.id) && (
                                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                    className={`text-[13px] p-2 rounded-lg overflow-hidden whitespace-pre-wrap ${n ? 'bg-night-surface text-night-muted' : 'bg-gray-50 text-day-muted'}`}>
                                    {msg.thinking}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </>
                          )}

                          {/* Legacy: tool calls above bubble */}
                          {msg.tool_calls && msg.tool_calls.length > 0 && (
                            <div className="w-fit max-w-[87%] mr-auto">
                              <button onClick={() => toggleTools(msg.id)} className={`text-xs flex items-center gap-1 ${n ? 'text-night-amber/70' : 'text-day-pink/70'}`}>
                                <ChevronDown size={12} className={`transition-transform ${expandedTools.has(msg.id) ? '' : '-rotate-90'}`} />
                                🔧 {msg.tool_calls.map((tc: any) => tc.name).join(', ')}
                              </button>
                              <AnimatePresence>
                                {expandedTools.has(msg.id) && (
                                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                    <div className={`text-xs space-y-1.5 p-2 rounded-xl ${n ? 'bg-night-surface/80' : 'bg-gray-50'}`}>
                                      {msg.tool_calls.map((tc: any, i: number) => (
                                        <div key={i} className={`p-2 rounded-lg space-y-1.5 ${n ? 'bg-night-card' : 'bg-white'}`}>
                                          <div>
                                            <span className={`font-medium ${n ? 'text-night-amber' : 'text-day-pink'}`}>{tc.name}</span>
                                          </div>
                                          {tc.input && Object.keys(tc.input).length > 0 && (
                                            <pre className={`text-[10px] leading-relaxed whitespace-pre-wrap break-all p-1.5 rounded ${n ? 'bg-night-surface text-night-muted' : 'bg-gray-100 text-day-muted'}`}>
                                              {JSON.stringify(tc.input, null, 2)}
                                            </pre>
                                          )}
                                          {tc.result && (
                                            <div className={`mt-1 pt-1.5 border-t ${n ? 'border-night-border' : 'border-gray-200'}`}>
                                              <span className="text-[10px] opacity-40 block mb-1">返回结果</span>
                                              <pre className={`text-[10px] leading-relaxed whitespace-pre-wrap break-all p-1.5 rounded max-h-[300px] overflow-y-auto ${n ? 'bg-night-surface text-night-muted' : 'bg-gray-100 text-day-muted'}`}>
                                                {tc.result}
                                              </pre>
                                            </div>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          )}
                        </>
                      )}

                      {/* bubble — skip for content_blocks messages (text rendered inline above) */}
                      {isEditing ? (
                        <div className={`rounded-2xl overflow-hidden ${isUser ? 'rounded-br-md' : 'rounded-bl-md'}`}>
                          <textarea value={editingMsgText} onChange={(e) => setEditingMsgText(e.target.value)}
                            className={`w-full p-3 text-sm outline-none resize-y ${n ? 'bg-night-surface text-night-text' : 'bg-gray-50 text-day-text'}`} rows={3} autoFocus />
                          <div className={`flex gap-2 justify-end px-3 py-2 ${n ? 'bg-night-surface' : 'bg-gray-50'}`}>
                            <button onClick={() => { setEditingMsgId(null); setEditingMsgText('') }} className="text-xs opacity-60">取消</button>
                            <button onClick={finishEditMsg} className={`text-xs font-medium ${n ? 'text-night-amber' : 'text-day-pink'}`}>保存</button>
                          </div>
                        </div>
                      ) : ((isUser || !msg.content_blocks || msg.content_blocks.length === 0) && (msg.content.trim() || (msg.images?.length || 0) > 0)) ? (
                        <div className={`block break-words px-4 py-3 rounded-2xl text-[14px] leading-relaxed backdrop-blur-[2px] ${isUser ? 'w-fit max-w-[80%] rounded-br-md ml-auto' : 'w-fit max-w-[87%] rounded-bl-md mr-auto'} ${(isUser ? !uColor : !aColor) ? (isUser ? (n ? 'bg-night-amber/20 text-night-text' : 'bg-day-honey text-day-text') : (n ? 'bg-night-surface text-night-text' : 'bg-white shadow-sm text-day-text')) : ''}`}
                          style={isUser ? (uColor ? userBubbleStyle : {}) : (aColor ? aiBubbleStyle : {})}>
                          {msg.images && msg.images.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-1.5">
                              {msg.images.map((src, i) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img key={i} src={src} alt="" className="max-w-[180px] max-h-[180px] rounded-lg object-cover" />
                              ))}
                            </div>
                          )}
                          {msg.content.trim() && <MarkdownText content={msg.content} />}
                        </div>
                      ) : null}

                      {/* AI model + tokens */}
                      {!isUser && (
                        <div className={`text-[10px] px-1 flex flex-wrap gap-x-2 ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                          {msg.modelId && <span className="opacity-40">{msg.modelId}</span>}
                          {(msg.input_tokens != null && msg.input_tokens > 0) && (() => {
                            const inp = msg.input_tokens || 0
                            const out = msg.output_tokens || 0
                            const cr = msg.cache_read_tokens || 0
                            const ratio = (inp + cr) > 0 ? Math.round((cr / (inp + cr)) * 100) : 0
                            return (
                              <span className="opacity-60" title={`输入${inp} · 输出${out} · 缓存命中${ratio}%`}>
                                ↑{inp.toLocaleString()}・↓{out.toLocaleString()}
                                {cr > 0 && <span className={n ? 'text-night-amber' : 'text-day-pink'}>・⚡️{ratio}%</span>}
                              </span>
                            )
                          })()}
                        </div>
                      )}

                      {/* action buttons */}
                      <div className={`flex items-center gap-1 ${isUser ? 'justify-end' : 'justify-start'} opacity-40 hover:opacity-100 transition-opacity relative`}>
                        <button onClick={() => handleRetry(msg)} title="重试" className="p-1"><RotateCcw size={12} /></button>
                        <button onClick={() => handleDeleteMsg(msg.id)} title="删除" className="p-1"><Trash2 size={12} /></button>
                        <button onClick={() => handleCopy(msg.id, msg.content)} title="复制" className="p-1">
                          {copiedId === msg.id ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                        {isUser && <button onClick={() => startEditMsg(msg)} title="修改" className="p-1"><Pencil size={12} /></button>}
                        {deleteMenuId === msg.id && (
                          <div className={`absolute ${isUser ? 'right-0' : 'left-0'} top-full mt-1 z-20 rounded-xl shadow-lg border py-1 min-w-[160px] ${n ? 'bg-night-card border-night-border' : 'bg-white border-gray-200'}`}>
                            <button onClick={() => doDeleteVersion(msg)} className={`w-full text-left px-3 py-2 text-xs ${n ? 'hover:bg-night-surface' : 'hover:bg-gray-50'}`}>删除此版本{(msg.versions?.length || 0) > 1 ? ` (${(msg.versionIndex ?? 0) + 1}/${msg.versions!.length})` : ''}</button>
                            <button onClick={() => doDeleteAllVersions(msg.id)} className={`w-full text-left px-3 py-2 text-xs text-red-500 ${n ? 'hover:bg-night-surface' : 'hover:bg-gray-50'}`}>删除全部版本</button>
                          </div>
                        )}
                      </div>

                      {/* version switcher */}
                      {hasVersions && (
                        <div className={`flex items-center gap-2 text-[10px] ${isUser ? 'justify-end' : 'justify-start'} ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                          <button disabled={vIdx <= 0} onClick={() => switchMessageVersion(msg.id, vIdx - 1)} className="p-0.5 disabled:opacity-20"><ChevronLeft size={11} /></button>
                          <span>{vIdx + 1}/{versions.length}</span>
                          <button disabled={vIdx >= versions.length - 1} onClick={() => switchMessageVersion(msg.id, vIdx + 1)} className="p-0.5 disabled:opacity-20"><ChevronRight size={11} /></button>
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
                <div className="w-full space-y-1.5">
                  {/* Render streaming blocks inline */}
                  {streamBlocks.length > 0 ? streamBlocks.map((block, bi) => {
                    const isLast = bi === streamBlocks.length - 1
                    if (block.type === 'thinking' && block.content) {
                      const bk = `stream-b${bi}`
                      const isExp = expandedThinking.has(bk)
                      return (
                        <div key={bi}>
                          <button onClick={() => toggleThinking(bk)} className={`text-xs flex items-center gap-1 max-w-full ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                            <ChevronDown size={12} className={`transition-transform flex-shrink-0 ${isExp ? '' : '-rotate-90'}`} />
                            <span className="truncate">💭星星的小算盘{!isExp && isLast ? <span className="stream-cursor">…</span> : ''}</span>
                          </button>
                          {isExp && (
                            <div className={`text-[13px] p-2 rounded-lg whitespace-pre-wrap ${n ? 'bg-night-surface text-night-muted' : 'bg-gray-50 text-day-muted'}`}>
                              {block.content}{isLast ? <span className="stream-cursor">…</span> : ''}
                            </div>
                          )}
                        </div>
                      )
                    }
                    if (block.type === 'tool_call' && block.name) {
                      return (
                        <div key={bi} className={`w-fit max-w-[87%] mr-auto rounded-xl border ${n ? 'border-night-border bg-night-surface/40' : 'border-gray-200 bg-gray-50/60'}`}>
                          <div className={`flex items-center gap-2 px-3 py-2 text-xs ${n ? 'text-night-muted' : 'text-day-muted'}`}>
                            <span className={`${n ? 'text-night-amber' : 'text-day-pink'}`}>🔧</span>
                            <span>调用工具: <span className={`font-medium ${n ? 'text-night-amber' : 'text-day-pink'}`}>{block.name}</span></span>
                            <ChevronDown size={12} className="ml-auto -rotate-90" />
                          </div>
                        </div>
                      )
                    }
                    if (block.type === 'text' && typeof block.content === 'string' && block.content.trim()) {
                      return (
                        <div key={bi} className={`block w-fit max-w-[87%] mr-auto break-words px-4 py-3 rounded-2xl rounded-bl-md text-[14px] leading-relaxed backdrop-blur-[2px] ${!aColor ? (n ? 'bg-night-surface text-night-text' : 'bg-white shadow-sm text-day-text') : ''}`} style={aColor ? aiBubbleStyle : {}}>
                          <MarkdownText content={block.content} cursor={isLast} />
                        </div>
                      )
                    }
                    return null
                  }) : (
                    /* No blocks yet — show loading dots */
                    <div className={`w-fit max-w-[87%] mr-auto px-4 py-3 rounded-2xl rounded-bl-md backdrop-blur-[2px] ${!aColor ? (n ? 'bg-night-surface' : 'bg-white shadow-sm') : ''}`} style={aColor ? aiBubbleStyle : {}}>
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
            <div className={`text-[10px] mb-2 px-1 space-y-0.5 ${n ? 'text-night-muted' : 'text-day-muted'}`}>
              <div className="flex justify-between">
                <span>共 {activeSession?.messageCount || messages.length} 层</span>
                <div className="flex items-center gap-2">
                  {timelineCurrent && <button onClick={() => setTimelineOpen(true)} className={`max-w-[52vw] truncate flex items-center gap-1 ${n ? 'text-night-amber' : 'text-day-pink'}`} title={`正在做：${timelineCurrent.title}`}><Clock3 size={11}/>正在 {timelineCurrent.title} ({timelineElapsedText})</button>}
                  <button onClick={() => setBookmarkDialogOpen(true)} className="opacity-60 hover:opacity-100 flex items-center gap-1" title="书签">
                    <BookMarked size={11} /> 书签{settings.bookmarks.length > 0 ? ` (${settings.bookmarks.length})` : ''}
                  </button>
                </div>
              </div>
            </div>

            {/* pending image previews */}
            {/* Photo wall prompt */}
            {photoPrompt && (
              <div className={`mx-1 mb-2 p-3 rounded-xl text-xs space-y-2 ${n ? "bg-night-surface" : "bg-gray-50 border"}`}>
                <p className="font-medium">📷 要把这张照片贴到照片墙吗？</p>
                <div className="flex items-center gap-2">
                  <button onClick={() => handlePhotoPromptChoice("public")}
                    className={`px-3 py-1.5 rounded-lg ${n ? "bg-night-amber/20 text-night-amber" : "bg-day-pinkLight text-day-pink"}`}>公开贴</button>
                  <button onClick={() => handlePhotoPromptChoice("locked")}
                    className={`px-3 py-1.5 rounded-lg ${n ? "bg-night-surface border border-night-amber/30 text-night-amber" : "bg-white border text-day-pink"}`}>🔒 上锁贴</button>
                  <button onClick={() => handlePhotoPromptChoice("no")}
                    className="px-3 py-1.5 rounded-lg opacity-50 hover:opacity-80">不贴</button>
                </div>
              </div>
            )}
            {pendingImages.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2 px-1">
                {pendingImages.map((src, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" className="w-14 h-14 object-cover rounded-lg" />
                    <button onClick={() => setPendingImages((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1.5 -right-1.5 bg-black/60 text-white rounded-full p-0.5">
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* input area */}
            <div className={`chat-input-tray flex items-end gap-2 px-3 py-2 rounded-2xl border transition-all duration-200 ${n ? 'bg-night-surface/95 border-night-border/80 shadow-[0_8px_24px_rgba(0,0,0,0.22)] focus-within:border-night-amber/50 focus-within:shadow-[0_10px_30px_rgba(226,168,75,0.10)]' : 'bg-[#fffaf7]/95 border-day-muted/10 shadow-[0_8px_24px_rgba(93,64,55,0.10)] focus-within:border-day-pink/35 focus-within:shadow-[0_10px_30px_rgba(239,64,103,0.10)]'}`}>
              <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
                placeholder={inputPlaceholder} rows={1} enterKeyHint="enter"
                className={`no-frame flex-1 resize-none bg-transparent outline-none text-sm py-1 max-h-40 ${n ? 'text-night-text placeholder:text-night-muted' : 'text-day-text placeholder:text-day-muted'}`} />
              <input ref={imgInputRef} type="file" accept="image/*" hidden onChange={handleUploadImage} />
              <button onClick={() => setTimelineOpen(true)} title={timelineCurrent ? `结束：${timelineCurrent.title}` : '开始计时'} className={`p-2 rounded-xl flex-shrink-0 ${timelineCurrent ? (n ? 'text-night-amber bg-night-amber/10' : 'text-day-pink bg-day-pinkLight') : 'opacity-60 hover:opacity-100'}`}><Clock3 size={16}/></button>
              <button onClick={() => imgInputRef.current?.click()} disabled={uploadingImg} title="上传图片到照片墙"
                className={`p-2 rounded-xl flex-shrink-0 opacity-60 hover:opacity-100 disabled:opacity-30 ${uploadingImg ? 'animate-pulse' : ''}`}>
                <ImagePlus size={16} />
              </button>
              <button onClick={handleSend} disabled={(!input.trim() && pendingImages.length === 0) || isLoading}
                className={`p-2 rounded-xl transition-all flex-shrink-0 ${(input.trim() || pendingImages.length) ? (n ? 'bg-night-amber text-night-bg hover:bg-night-amberGlow' : 'bg-day-pink text-white hover:bg-day-pink/80') : 'opacity-30 cursor-not-allowed'}`}>
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
                <motion.div initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }} transition={{ type: 'spring', damping: 30, stiffness: 280 }} className="fixed left-0 top-0 bottom-0 z-[61] lg:hidden" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
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
                  className={`fixed bottom-0 left-0 right-0 z-[61] max-h-[65dvh] rounded-t-2xl shadow-2xl flex flex-col ${n ? 'bg-night-card text-night-text' : 'bg-[#faf9f5] text-day-text'}`}
                  style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
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
                  className={`fixed z-[71] inset-x-0 mx-auto w-[min(340px,calc(100vw-3rem))] rounded-2xl shadow-2xl p-6 ${n ? 'bg-night-card text-night-text' : 'bg-white text-day-text'}`}
                  style={{ top: 'max(env(safe-area-inset-top, 0px) + 30dvh, 30dvh)', transform: 'translateY(-50%)' }}>
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
          <TimelineTimerModal open={timelineOpen} current={timelineCurrent} onClose={() => setTimelineOpen(false)} onChanged={() => refreshTimelineCurrent()} />
        </>,
        document.body,
      )}


    </>
  )
}
