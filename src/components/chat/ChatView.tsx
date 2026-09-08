'use client'

import { useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '@/lib/theme'
import { useApp } from '@/lib/store'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send, ChevronDown, ChevronLeft, ChevronRight, Settings2, PanelLeft,
  Plus, Pin, Trash2, Pencil, Search, X, Copy, Check, RotateCcw, BookMarked, ImagePlus, Clock3, FileText, Square,
} from 'lucide-react'
import {
  useChatStore, ChatMessage, MessageVersion, ContentBlock, snapshotOfMessage,
  getActiveProfile, getEnabledModels, getSortedSessions, getTriggeredBookmarks, ChatSummary, StageSummary,
} from '@/lib/chatStore'
import { photos as photosApi } from '@/lib/api'
import type { SharedCard } from '@/lib/share'
import { ChatSettings } from './ChatSettings'
import { normalizeReplyMode, type ReplyMode } from '@/lib/chat-reply-mode'
import { applyBubbleLayout, cleanLegacyBubbleMarkers, cleanReplyBlocks, composeBubbleBlocks, composeBubbleLayout } from '@/lib/chat-bubble-composer'
import { bubbleAppearance } from '@/features/chat/settings/appearance'
import { ModelDialog } from './ModelDialog'
import { BookmarkDialog } from './BookmarkDialog'
import { SummaryDialog } from './SummaryDialog'
import { MessageReceiptDialog } from './MessageReceiptDialog'
import { TimelineTimerModal } from '@/components/timeline/TimelineTimerModal'
import { SyncBadge } from '@/components/layout/SyncBadge'
import { MarkdownText } from './MarkdownText'
import { APP_TIME_ZONE, formatMadrid } from '@/lib/madrid-time'
import { buildSummaryRounds, selectLoadedSessionSummarySegment } from '@/lib/chat-summary'
import { chatApi, type CcStatus } from '@/features/chat/api/client'
import { readChatEventStream } from '@/features/chat/api/event-stream'
import { timeline as timelineApi } from '@/lib/api'
import { loadEarlierChat, syncChatNow } from '@/features/chat/sync/ChatSync'
import { flushChatOutbox, queueChatAppend } from '@/features/chat/sync/outbox'
import { CHAT_PAGE_SIZE, useChatViewState } from '@/features/chat/view/useChatViewState'
import { StreamingReply } from '@/features/chat/components/StreamingReply'
import { ChatRouteChip, ChatRoutePicker } from '@/features/chat/components/ChatRoutePicker'
import { chatRouteLabel, normalizeChatRoute } from '@/lib/chat-route'
import { measureReceiptText } from '@/lib/chat-receipt'

/* ── helpers ────────────────────────────── */

const fmtFullTs = (ts: number) => {
  try { return formatMadrid(Number(ts) || Date.now()) } catch { return '' }
}

const fmtShortDate = (ts: number) => {
  const d = new Date(ts)
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(new Date())
  const key = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(d)
  if (key === todayKey) return d.toLocaleTimeString('en-GB', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false })
  return d.toLocaleDateString('zh-CN', { timeZone: APP_TIME_ZONE, month: 'short', day: 'numeric' })
}

const EMPTY_CC_STATUS: CcStatus = {
  configured: false,
  available: false,
  toolsAvailable: false,
  model: null,
  version: null,
  quota: { available: false, reason: 'gateway_unavailable', source: 'claude_code_headless', collectedAt: null },
  context: { available: false, reason: 'gateway_unavailable', source: 'last_assistant_usage', collectedAt: null },
}

const fmtTokens = (value?: number | null) => {
  if (!Number.isFinite(value)) return '—'
  const tokens = Number(value)
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(1))}K`
  return String(tokens)
}

const fmtMetricTime = (value?: string | null) => {
  if (!value) return '尚未采集'
  return new Date(value).toLocaleTimeString('zh-CN', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false })
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

/* ── main component ─────────────────────── */

export interface ChatViewProps {
  embedded?: boolean
  contextInjection?: string
  title?: string
  inputPlaceholder?: string
  onTurn?: (role: 'user' | 'assistant', content: string) => void
}

export function ChatView({ embedded = false, contextInjection = '', title, inputPlaceholder = '说点什么...', onTurn }: ChatViewProps = {}) {
  const { setActiveTab } = useApp()
  const { theme } = useTheme()
  const n = theme === 'night'
  const [moreOpen, setMoreOpen] = useState(false)
  const {
    messages, settings,
    addMessage, updateMessage, createSession, setActiveSession,
    renameSession, deleteSession, togglePinSession, setActiveModel,
    setGenerationRoute, setConversationMode, deleteMessage, addMessageVersion, switchMessageVersion, deleteMessageVersion, continueSession, addSummary, updateSummary, addStageSummary,
  } = useChatStore()
  const activeProfile = getActiveProfile(settings)
  const enabledModels = getEnabledModels(settings)
  const sessions = getSortedSessions(settings)
  const activeSession = settings.sessions.find((s) => s.id === settings.activeSessionId)
  const activeModel = activeProfile?.models.find(model => model.id === settings.model)
  const activeRoute = normalizeChatRoute(activeSession?.generationRoute)
  const [ccStatus, setCcStatus] = useState<CcStatus>(EMPTY_CC_STATUS)
  const [receiptMessage, setReceiptMessage] = useState<ChatMessage | null>(null)

  const {
    input, setInput, isLoading, setIsLoading,
    streamText, setStreamText, streamThinking, setStreamThinking, streamBlocks, setStreamBlocks,
    expandedThinking, setExpandedThinking, expandedTools, setExpandedTools,
    settingsOpen, setSettingsOpen, modelDialogOpen, setModelDialogOpen,
    bookmarkDialogOpen, setBookmarkDialogOpen, summaryDialogOpen, setSummaryDialogOpen,
    summaryGenerating, setSummaryGenerating, summaryError, setSummaryError, summaryGeneratingRef, summaryAttemptRef,
    stageSummaryGenerating, setStageSummaryGenerating, stageAttemptRef,
    timelineOpen, setTimelineOpen, timelineCurrent, setTimelineCurrent, timelineNow, setTimelineNow,
    sessionDrawerOpen, setSessionDrawerOpen, modelPickerOpen, setModelPickerOpen,
    sessionSearch, setSessionSearch, editingSessionId, setEditingSessionId,
    editingTitle, setEditingTitle, editingMsgId, setEditingMsgId, editingMsgText, setEditingMsgText,
    copiedId, setCopiedId, mounted, setMounted,
    uploadingImg, setUploadingImg, pendingImages, setPendingImages, pendingShare, setPendingShare,
    visibleCount, setVisibleCount, historyLoading, setHistoryLoading, photoPrompt, setPhotoPrompt,
    deleteMenuId, setDeleteMenuId,
    messagesEndRef, inputRef, imgInputRef, scrollRef, stickBottomRef, abortControllerRef,
    activeGenerationRef, explicitStopRef, recoveredTurnsRef,
    confirmState, ask, answer,
  } = useChatViewState()

  useEffect(() => { setMounted(true) }, [])
  const refreshCcStatus = useCallback(async () => {
    try { setCcStatus(await chatApi.ccStatus(activeSession?.id)) }
    catch { setCcStatus(current => ({ ...current, available: false })) }
  }, [activeSession?.id])
  useEffect(() => { void refreshCcStatus() }, [refreshCcStatus])
  useEffect(() => { if (modelPickerOpen) void refreshCcStatus() }, [modelPickerOpen, refreshCcStatus])
  useEffect(() => {
    const accept = (detail: SharedCard | string) => {
      if (typeof detail === 'string') setInput((v) => v ? v + '\n\n' + detail : detail)
      else setPendingShare(detail)
    }
    const onShare = (e: Event) => {
      const detail = (e as CustomEvent<SharedCard | string>).detail
      if (detail) accept(detail)
    }
    try {
      const raw = sessionStorage.getItem('lumbre-pending-share')
      if (raw) { accept(JSON.parse(raw) as SharedCard); sessionStorage.removeItem('lumbre-pending-share') }
    } catch {}
    window.addEventListener('lumbre-share-to-chat', onShare)
    return () => window.removeEventListener('lumbre-share-to-chat', onShare)
  }, [])
  useEffect(() => () => abortControllerRef.current?.abort(), [settings.activeSessionId])
  // Entering Chat should resume the most recently used conversation, not a
  // stale/blank draft left active by an earlier reload or another device.
  useEffect(() => {
    const latest = settings.sessions
      .filter((session) => !((session.messageCount || session.messages.length) === 0 && !session.pinned))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (latest && latest.id !== settings.activeSessionId) setActiveSession(latest.id)
    // This is intentionally mount-only: once the user switches chats, sync or
    // incoming wake messages must not pull the UI away from their choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const refreshTimelineCurrent = useCallback(async () => {
    try { const data = await timelineApi.current(); setTimelineCurrent(data.current || null) } catch {}
  }, [])
  useEffect(() => { refreshTimelineCurrent(); const t = setInterval(refreshTimelineCurrent, 30000); return () => clearInterval(t) }, [refreshTimelineCurrent])
  useEffect(() => { const t = setInterval(() => setTimelineNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const timelineElapsed = timelineCurrent ? Math.max(0, Math.floor((timelineNow - new Date(timelineCurrent.start_at).getTime()) / 1000)) : 0
  const timelineElapsedText = `${String(Math.floor(timelineElapsed / 3600)).padStart(2, '0')}:${String(Math.floor((timelineElapsed % 3600) / 60)).padStart(2, '0')}:${String(timelineElapsed % 60).padStart(2, '0')}`

  // Lazy-load: only render the most recent messages to keep the window snappy.
  useEffect(() => { setVisibleCount(CHAT_PAGE_SIZE) }, [settings.activeSessionId, setVisibleCount])
  const hiddenCount = Math.max(0, messages.length - visibleCount)
  const serverHiddenCount = activeSession?.partial
    ? Math.max(0, Number(activeSession.messageCount || 0) - messages.length)
    : 0
  const visibleMessages = hiddenCount > 0 ? messages.slice(-visibleCount) : messages

  const handleLoadEarlier = async () => {
    if (hiddenCount > 0) {
      setVisibleCount((count) => count + CHAT_PAGE_SIZE)
      return
    }
    if (!activeSession?.id || !serverHiddenCount || historyLoading) return
    setHistoryLoading(true)
    try {
      const loaded = await loadEarlierChat(activeSession.id)
      if (loaded) setVisibleCount((count) => count + loaded)
    } catch {
      // SyncBadge already exposes connectivity errors; keep the chat usable.
    } finally {
      setHistoryLoading(false)
    }
  }

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

  const doSend = async (
    sendMessages: { id: string; role: string; route?: 'api' | 'claude-code'; ccAttemptId?: string; content: string; images?: string[] }[],
    onResult: (data: any) => void | Promise<void>,
    requestedMode?: ReplyMode,
    requestedRoute = activeRoute,
    turnId = sendMessages.at(-1)?.id || '',
    sessionAction?: 'rebase',
  ) => {
    const mode = requestedMode || normalizeReplyMode(activeSession?.conversationMode)
    const route = normalizeChatRoute(requestedRoute)
    const onDone = (data: any) => {
      const content = mode === 'short' ? cleanLegacyBubbleMarkers(String(data.content || '')) : data.content
      const blocks: ContentBlock[] | undefined = data.content_blocks
        ? (mode === 'short' ? cleanReplyBlocks(data.content_blocks) : data.content_blocks.map((block: ContentBlock) => ({ ...block })))
        : (mode === 'short' && content.trim() ? [{ type: 'text', content }] : undefined)
      return onResult({
        ...data,
        replyMode: mode,
        content,
        content_blocks: blocks,
        bubbleLayout: mode === 'short' && blocks ? composeBubbleLayout(blocks) : undefined,
      })
    }
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
    const summaryConfig = activeSession?.summaryConfig || { injectCount: settings.summaryInjectCount }
    const recentSummaries = [...(activeSession?.summaries || [])].sort((a, b) => b.endAt - a.endAt).slice(0, summaryConfig.injectCount).reverse()
    const recentStages = [...(activeSession?.stageSummaries || [])].sort((a, b) => b.endAt - a.endAt).slice(0, 2).reverse()
    const summaryInjection = recentSummaries.length || recentStages.length ? `[长期对话摘要｜马德里时间]\n${recentStages.map((item, i) => `阶段摘要${i + 1}（${fmtFullTs(item.startAt)} - ${fmtFullTs(item.endAt)}）\n${item.title}\n${item.content}`).join('\n\n---\n\n')}${recentStages.length && recentSummaries.length ? '\n\n=== 最近细节 ===\n\n' : ''}${recentSummaries.map((item, i) => `记忆${i + 1}（${fmtFullTs(item.startAt)} - ${fmtFullTs(item.endAt)}）\n${item.eventSummary}`).join('\n\n---\n\n')}` : ''
    const bookmarkInjections = [summaryInjection, readingInjection, statusInjection].filter(Boolean).join('\n\n')

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
    let fullText = ''
    let fullThinking = ''
    let toolCalls: any[] = []
    let contentBlocks: ContentBlock[] = []
    let usage: any = {}
    let ccAttemptId: string | undefined
    let ccSessionMode: 'bootstrap' | 'resume' | 'rebase' | undefined
    let ccSessionReason: string | undefined
    let ccSessionFingerprint: string | undefined
    let ccCompacted: boolean | undefined
    let paintTimer: ReturnType<typeof setTimeout> | null = null
    const paintStream = () => {
      paintTimer = null
      if (!live) return
      setStreamText(fullText)
      setStreamThinking(fullThinking)
      setStreamBlocks(mode === 'short' ? composeBubbleBlocks(contentBlocks).blocks : contentBlocks.map(block => ({ ...block })))
    }
    // iOS PWA becomes unstable when Markdown and the whole message list are
    // reconciled for every token. Paint at most once per 80ms while preserving
    // every byte in the local accumulators and final saved message.
    const scheduleStreamPaint = () => {
      if (live && !paintTimer) paintTimer = setTimeout(paintStream, 80)
    }
    const controller = new AbortController()
    abortControllerRef.current = controller
    explicitStopRef.current = false
    if (activeSession?.id && turnId) activeGenerationRef.current = { route, sessionId: activeSession.id, turnId }
    const resolveConfirmation = async (event: any) => {
      let payload: any
      try { payload = JSON.parse(event.result || '') } catch { return event }
      if (payload?.code !== 'CONFIRMATION_REQUIRED' || !payload.confirmation?.token) return event
      const label = payload.confirmation.label || event.name || '危险操作'
      const target = payload.confirmation.target ? `\n目标：${payload.confirmation.target}` : ''
      const approve = window.confirm(`星星请求执行：${label}${target}\n\n是否允许这一次操作？`)
      try {
        const resolved = await chatApi.confirmTool({
          token: payload.confirmation.token,
          approve,
          session_id: activeSession?.id,
        })
        return {
          ...event,
          result: resolved.result || (approve ? '确认执行失败' : '用户已取消操作'),
          error: !resolved.ok,
        }
      } catch {
        return { ...event, result: approve ? '确认请求失败，操作未执行' : '用户已取消操作', error: approve }
      }
    }
    try {
      const res = await chatApi.stream({
        generation_route: route,
        turn_id: route === 'claude-code' ? turnId : undefined,
        cc_session_action: route === 'claude-code' ? sessionAction : undefined,
        messages: sendMessages,
        system: systemPrompt,
        model,
        reply_mode: mode,
        thinking_budget: settings.thinkingBudget,
        prompt_caching: settings.promptCaching,
        temperature: settings.temperature,
        stream: true,
        session_id: activeSession?.id,
        bookmark_injections: bookmarkInjections,
        request_audit_hints: {
          summary: measureReceiptText(summaryInjection),
          currentContext: measureReceiptText([readingInjection, statusInjection].filter(Boolean).join('\n\n')),
        },
        api_profile: route === 'api' && profile ? {
          profileId: profile.id, modelId: model,
        } : undefined,
      }, controller.signal)
      if (!res.ok) {
        const errText = await res.text()
        await onDone({ content: `Error ${res.status}: ${errText.slice(0, 200)}`, error: true })
        return
      }
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
        scheduleStreamPaint()
      }

      for await (const evt of readChatEventStream(res)) {
        if (evt.type === 'attempt') {
          ccAttemptId = typeof evt.attempt_id === 'string' ? evt.attempt_id : undefined
          ccSessionMode = ['bootstrap', 'resume', 'rebase'].includes(String(evt.session_mode)) ? evt.session_mode as any : undefined
          ccSessionReason = typeof evt.session_reason === 'string' ? evt.session_reason : undefined
        } else if (evt.type === 'text') {
          const chunk = String(evt.content || '')
          fullText += chunk
          appendContentBlock({ type: 'text', content: chunk })
        } else if (evt.type === 'thinking') {
          const chunk = String(evt.content || '')
          fullThinking += chunk
          appendContentBlock({ type: 'thinking', content: chunk })
        } else if (evt.type === 'tool_call') {
          const resolved = await resolveConfirmation(evt)
          toolCalls.push(resolved)
          appendContentBlock({ type: 'tool_call', name: resolved.name, input: resolved.input, result: resolved.result })
        } else if (evt.type === 'error') {
          const errorText = (fullText ? '\n\n' : '') + '⚠️ ' + (evt.content || '出错了')
          fullText += errorText
          appendContentBlock({ type: 'text', content: errorText })
        } else if (evt.type === 'recoverable_disconnect') {
          throw Object.assign(new Error(evt.content || 'CC 连接暂时中断'), { name: 'AbortError' })
        } else if (evt.type === 'done') {
          usage = evt
          ccAttemptId = typeof evt.attempt_id === 'string' ? evt.attempt_id : ccAttemptId
          ccSessionFingerprint = typeof evt.session_fingerprint === 'string' ? evt.session_fingerprint : undefined
          ccSessionMode = ['bootstrap', 'resume', 'rebase'].includes(String(evt.session_mode)) ? evt.session_mode as any : ccSessionMode
          ccSessionReason = typeof evt.session_reason === 'string' ? evt.session_reason : ccSessionReason
          ccCompacted = typeof evt.compacted === 'boolean' ? evt.compacted : ccCompacted
        }
      }
      if (paintTimer) clearTimeout(paintTimer)
      paintStream()
      await onDone({
        content: fullText,
        thinking: fullThinking || undefined,
        tool_calls: toolCalls.length ? toolCalls : undefined,
        content_blocks: contentBlocks.length ? contentBlocks : undefined,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        cache_read_tokens: usage.cache_read_tokens,
        cache_creation_tokens: usage.cache_creation_tokens,
        request_audit: usage.request_audit,
        ccAttemptId,
        ccSessionFingerprint,
        ccSessionMode,
        ccSessionReason,
        ccCompacted,
      })
      if (route === 'claude-code') void refreshCcStatus()
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        if (explicitStopRef.current) {
          await onDone({
            content: fullText || '已停止生成。',
            thinking: fullThinking || undefined,
            tool_calls: toolCalls.length ? toolCalls : undefined,
            content_blocks: contentBlocks.length ? contentBlocks : undefined,
            ccAttemptId,
            stopped: true,
          })
        } else {
          // Tab close, refresh, PWA suspension and session switches are only
          // disconnects. Leave the user turn pending so it can recover later.
          setIsLoading(false)
          setStreamText('')
          setStreamThinking('')
          setStreamBlocks([])
        }
      } else {
        const failure = '\n\n⚠️ ' + (err?.message || '连接失败了…')
        await onDone({ content: fullText + failure, thinking: fullThinking || undefined, content_blocks: [...contentBlocks, { type: 'text', content: failure }], tool_calls: toolCalls.length ? toolCalls : undefined, error: true, stopped: true })
      }
    } finally {
      if (paintTimer) clearTimeout(paintTimer)
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      if (activeGenerationRef.current?.turnId === turnId) activeGenerationRef.current = null
      explicitStopRef.current = false
    }
  }

  const generateNextSummary = useCallback(async (silent = false, autoOnly = false) => {
    const state = useChatStore.getState()
    const session = state.settings.sessions.find(item => item.id === state.settings.activeSessionId)
    if (!session || summaryGeneratingRef.current) return false
    const config = session.summaryConfig || { autoEnabled: true, turnSize: state.settings.summaryTurnSize, injectCount: state.settings.summaryInjectCount, modeVersion: 2 as const }
    if (autoOnly && !config.autoEnabled) return false
    const segment = selectLoadedSessionSummarySegment(session, state.settings.summaryTurnSize, autoOnly)
    if (!segment.length) {
      if (!silent) setSummaryError('暂时没有可整理的完整对话轮次。')
      return false
    }
    const chosen = buildSummaryRounds(segment)
    const profile = state.settings.apiProfiles.find(item => item.id === config.profileId) || getActiveProfile(state.settings)
    const model = config.modelId || (profile?.id === state.settings.activeProfileId ? state.settings.model : profile?.defaultModel) || profile?.models[0]?.id || state.settings.model
    const attemptKey = `${profile?.id || ''}:${model}:${segment.map(message => message.id).join(',')}`
    if (autoOnly && summaryAttemptRef.current === attemptKey) return false
    if (autoOnly) summaryAttemptRef.current = attemptKey
    setSummaryError('')
    summaryGeneratingRef.current = true
    setSummaryGenerating(true)
    try {
      const data = await chatApi.summarize({
        messages: segment.map(message => ({ role: message.role, content: message.content, timestamp: message.timestamp })), model,
        api_profile: profile ? { profileId: profile.id, modelId: model } : undefined,
      })
      if (!data.content) throw new Error('摘要生成失败')
      addSummary(session.id, { id: `sum-${Date.now()}-${Math.random().toString(16).slice(2,6)}`, sessionId: session.id,
        startAt: segment[0].timestamp, endAt: segment[segment.length-1].timestamp, createdAt: Date.now(), turnCount: chosen.length,
        messageCount: segment.length, sourceMessageIds: segment.map(message => message.id), coveredUntilMessageId: segment[segment.length-1].id,
        eventSummary: String(data.content).trim() })
      void syncChatNow()
      summaryAttemptRef.current = ''
      return true
    } catch (err: any) {
      setSummaryError(err?.message || '摘要生成失败，请检查摘要 API 和模型设置。')
      if (!silent) console.error('summary generation failed', err)
      return false
    }
    finally { summaryGeneratingRef.current = false; setSummaryGenerating(false) }
  }, [addSummary, setSummaryError, setSummaryGenerating, summaryAttemptRef, summaryGeneratingRef])

  const regenerateSummary = useCallback(async (summary: ChatSummary) => {
    const state = useChatStore.getState()
    const session = state.settings.sessions.find(item => item.id === summary.sessionId)
    if (!session || summary.locked || summaryGenerating) return false
    const ids = new Set(summary.sourceMessageIds || [])
    const segment = ids.size ? session.messages.filter(message => ids.has(message.id)) : session.messages.filter(message => message.timestamp >= summary.startAt && message.timestamp <= summary.endAt)
    if (!segment.length) return false
    setSummaryError('')
    setSummaryGenerating(true)
    try {
      const config = session.summaryConfig || { autoEnabled: true, turnSize: state.settings.summaryTurnSize, injectCount: state.settings.summaryInjectCount, modeVersion: 2 as const }
      const profile = state.settings.apiProfiles.find(item => item.id === config.profileId) || getActiveProfile(state.settings)
      const model = config.modelId || (profile?.id === state.settings.activeProfileId ? state.settings.model : profile?.defaultModel) || profile?.models[0]?.id || state.settings.model
      const data = await chatApi.summarize({ messages: segment.map(message => ({ role: message.role, content: message.content, timestamp: message.timestamp })), model, api_profile: profile ? { profileId: profile.id, modelId: model } : undefined })
      if (!data.content) throw new Error('摘要重新生成失败')
      updateSummary(session.id, summary.id, { eventSummary: String(data.content).trim(), needsCorrection: false, editedAt: Date.now() })
      void syncChatNow()
      return true
    } catch (err: any) {
      setSummaryError(err?.message || '摘要重新生成失败。')
      console.error('summary regeneration failed', err)
      return false
    }
    finally { setSummaryGenerating(false) }
  }, [setSummaryError, setSummaryGenerating, summaryGenerating, updateSummary])

  const generateStageSummary = useCallback(async () => {
    const state = useChatStore.getState()
    const session = state.settings.sessions.find(item => item.id === state.settings.activeSessionId)
    if (!session || stageSummaryGenerating || session.summaryConfig?.autoEnabled === false) return false
    const covered = new Set((session.stageSummaries || []).flatMap(item => item.sourceSummaryIds))
    const available = [...(session.summaries || [])].sort((a, b) => a.startAt - b.startAt).filter(item => !covered.has(item.id))
    if (available.length < 10) return false
    const batch = available.slice(0, 10)
    const attemptKey = batch.map(item => item.id).join(',')
    if (stageAttemptRef.current === attemptKey) return false
    stageAttemptRef.current = attemptKey
    setSummaryError('')
    setStageSummaryGenerating(true)
    try {
      const config = session.summaryConfig || { autoEnabled: true, turnSize: state.settings.summaryTurnSize, injectCount: state.settings.summaryInjectCount, modeVersion: 2 as const }
      const profile = state.settings.apiProfiles.find(item => item.id === config.profileId) || getActiveProfile(state.settings)
      const model = config.modelId || (profile?.id === state.settings.activeProfileId ? state.settings.model : profile?.defaultModel) || profile?.models[0]?.id || state.settings.model
      const data = await chatApi.summarize({ kind: 'stage', summaries: batch.map(item => ({ content: item.eventSummary })), model, api_profile: profile ? { profileId: profile.id, modelId: model } : undefined })
      if (!data.content) throw new Error('阶段摘要生成失败')
      const stage: StageSummary = { id: `stage-${Date.now()}`, sessionId: session.id, createdAt: Date.now(), startAt: batch[0].startAt, endAt: batch[9].endAt, sourceSummaryIds: batch.map(item => item.id), title: String(data.title || '一段共同经历').trim(), content: String(data.content).trim() }
      addStageSummary(session.id, stage)
      void syncChatNow()
      stageAttemptRef.current = ''
      return true
    } catch (err: any) {
      setSummaryError(err?.message || '阶段摘要生成失败。')
      console.error('stage summary generation failed', err)
      return false
    }
    finally { setStageSummaryGenerating(false) }
  }, [addStageSummary, setStageSummaryGenerating, setSummaryError, stageSummaryGenerating])

  useEffect(() => {
    if (!activeSession || stageSummaryGenerating || activeSession.summaryConfig?.autoEnabled === false) return
    const timer = setTimeout(() => { void generateStageSummary() }, 1200)
    return () => clearTimeout(timer)
  }, [activeSession?.id, activeSession?.summaries?.length, activeSession?.stageSummaries?.length, activeSession?.summaryConfig?.autoEnabled, stageSummaryGenerating, generateStageSummary])

  useEffect(() => {
    const config = activeSession?.summaryConfig
    if (!activeSession || !config?.autoEnabled || summaryGenerating) return
    const timer = setTimeout(() => { void generateNextSummary(true, true) }, 650)
    return () => clearTimeout(timer)
  }, [activeSession?.id, activeSession?.updatedAt, activeSession?.summaryConfig?.autoEnabled,
    activeSession?.summaryConfig?.turnSize, activeSession?.summaryConfig?.anchorMessageId, summaryGenerating, generateNextSummary])

  const durableAppend = useCallback(async (session: any, message: ChatMessage) => {
    if (!session?.id || !message?.id) return
    try {
      await queueChatAppend(session, message)
    } catch {
      // Very old/private Safari modes can disable both IndexedDB and
      // localStorage. In that case, confirm the server write before painting.
      await chatApi.appendMessage(session.id, message, {
        title: session.title, pinned: session.pinned, createdAt: session.createdAt,
        summaryConfig: session.summaryConfig,
        generationRoute: session.generationRoute,
        generationRouteUpdatedAt: session.generationRouteUpdatedAt,
        conversationMode: session.conversationMode,
        conversationModeUpdatedAt: session.conversationModeUpdatedAt,
      })
    }
    void flushChatOutbox().catch(() => {})
  }, [])

  const handleSend = async () => {
    if ((!input.trim() && pendingImages.length === 0 && !pendingShare) || isLoading) return
    if (activeRoute === 'claude-code' && !ccStatus.available) {
      window.alert('CC 网关现在没有连上；本轮不会自动改走 API。')
      setModelPickerOpen(true)
      return
    }
    if (activeRoute === 'claude-code' && pendingImages.length > 0) {
      window.alert('CC 的图片通道还没有接好，这一轮请改走 API；文字聊天已经可以使用。')
      return
    }
    const profile = getActiveProfile(settings)
    const model = settings.model
    const now = Date.now()
    const userMsg: ChatMessage = {
      id: now.toString(),
      role: 'user',
      route: activeRoute,
      replyMode: normalizeReplyMode(activeSession?.conversationMode),
      content: input.trim(),
      timestamp: now,
      images: pendingImages.length ? pendingImages : undefined,
      sharedCard: pendingShare || undefined,
      ccGenerationState: activeRoute === 'claude-code' ? 'pending' : undefined,
      providerId: activeRoute === 'claude-code' ? 'claude-code' : profile?.id,
      modelId: activeRoute === 'claude-code' ? (ccStatus.model || 'sonnet') : model,
    }
    stickBottomRef.current = true
    await durableAppend(activeSession, userMsg)
    addMessage(userMsg, activeSession?.id)
    onTurn?.('user', userMsg.content)
    setInput('')
    setPendingImages([])
    setPendingShare(null)
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
      const cardText = m.sharedCard ? `\n\n[已分享卡片｜${m.sharedCard.kind}]\n${JSON.stringify(m.sharedCard.metadata)}\n${m.sharedCard.body || ''}` : ''
      return { id: m.id, role: m.role, route: normalizeChatRoute(m.route), ccAttemptId: m.ccAttemptId, content: msgContent + cardText, images: m.images }
    })

    await doSend(apiMessages, async (data) => {
      const assistantContent = data.content || data.error || '...'
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: assistantContent,
        timestamp: Date.now(),
        thinking: data.thinking,
        input_tokens: data.input_tokens,
        output_tokens: data.output_tokens,
        cache_read_tokens: data.cache_read_tokens,
        cache_creation_tokens: data.cache_creation_tokens,
        request_audit: data.request_audit,
        tool_calls: data.tool_calls,
        content_blocks: data.content_blocks,
        bubbleLayout: data.bubbleLayout,
        route: activeRoute,
        ccAttemptId: data.ccAttemptId,
        ccSessionFingerprint: data.ccSessionFingerprint,
        ccSessionMode: data.ccSessionMode,
        ccSessionReason: data.ccSessionReason,
        ccCompacted: data.ccCompacted,
        replyMode: data.replyMode,
        providerId: activeRoute === 'claude-code' ? 'claude-code' : profile?.id,
        modelId: activeRoute === 'claude-code' ? (ccStatus.model || 'sonnet') : model,
      }
      await durableAppend(activeSession, assistantMsg)
      addMessage(assistantMsg, activeSession?.id)
      if (activeRoute === 'claude-code') updateMessage(userMsg.id, { ccGenerationState: 'settled' })
      void syncChatNow()
      onTurn?.('assistant', assistantContent)
      setIsLoading(false)
      setStreamText('')
      setStreamThinking('')
      setStreamBlocks([])
    }, userMsg.replyMode, activeRoute, userMsg.id)
  }


  /* ── retry ────────────────────────────── */

  const handleRetry = async (msg: ChatMessage, skipConfirm = false, recoverPending = false) => {
    if (isLoading) return
    const retryRoute = normalizeChatRoute(msg.route)
    if (retryRoute === 'claude-code' && !ccStatus.available) {
      if (!recoverPending) window.alert('CC 网关现在没有连上；不会偷偷改走 API 重试。')
      return
    }
    if (!skipConfirm) {
      const ok = await ask(msg.role === 'assistant' ? '重新生成这条回复？' : '重新发送并生成回复？')
      if (!ok) return
    }

    const profile = getActiveProfile(settings)
    const model = settings.model
    setIsLoading(true)
    const currentMessages = useChatStore.getState().messages

    if (msg.role === 'assistant') {
      // Re-generate: use messages up to (but not including) this assistant message
      const idx = currentMessages.findIndex(m => m.id === msg.id)
      if (idx < 0) { setIsLoading(false); return }
      const slice = stableSlice(currentMessages.slice(0, idx), settings.contextLength)
      const apiMessages = slice.map(m => ({ id: m.id, role: m.role, route: normalizeChatRoute(m.route), ccAttemptId: m.ccAttemptId, content: m.content, images: m.images }))
      const retryTurnId = retryRoute === 'claude-code' ? `cc-reroll:${msg.id}:${Date.now()}` : msg.id

      await doSend(apiMessages, async (data) => {
        const newVersion: MessageVersion = {
          route: retryRoute,
          content: data.content || data.error || '...',
          timestamp: Date.now(),
          thinking: data.thinking,
          input_tokens: data.input_tokens,
          output_tokens: data.output_tokens,
          cache_read_tokens: data.cache_read_tokens,
          cache_creation_tokens: data.cache_creation_tokens,
          request_audit: data.request_audit,
          tool_calls: data.tool_calls,
          content_blocks: data.content_blocks,
          bubbleLayout: data.bubbleLayout,
          ccAttemptId: data.ccAttemptId,
          ccSessionFingerprint: data.ccSessionFingerprint,
          ccSessionMode: data.ccSessionMode,
          ccSessionReason: data.ccSessionReason,
          ccCompacted: data.ccCompacted,
          replyMode: data.replyMode,
          providerId: retryRoute === 'claude-code' ? 'claude-code' : profile?.id,
          modelId: retryRoute === 'claude-code' ? (ccStatus.model || 'sonnet') : model,
        }
        addMessageVersion(msg.id, newVersion, activeSession?.id)
        void syncChatNow()
        setIsLoading(false)
        setStreamText('')
        setStreamThinking('')
        setStreamBlocks([])
      }, normalizeReplyMode(msg.replyMode), retryRoute, retryTurnId, retryRoute === 'claude-code' ? 'rebase' : undefined)
    } else {
      // User retry: regenerate the AI response that follows
      const idx = currentMessages.findIndex(m => m.id === msg.id)
      if (idx < 0) { setIsLoading(false); return }
      const nextMsg = currentMessages[idx + 1]
      const slice = stableSlice(currentMessages.slice(0, idx + 1), settings.contextLength)
      const apiMessages = slice.map(m => ({ id: m.id, role: m.role, route: normalizeChatRoute(m.route), ccAttemptId: m.ccAttemptId, content: m.content, images: m.images }))
      const retryTurnId = retryRoute === 'claude-code'
        ? (recoverPending ? msg.id : `cc-retry:${msg.id}:${Date.now()}`)
        : msg.id

      await doSend(apiMessages, async (data) => {
        const reply = {
          route: retryRoute,
          content: data.content || data.error || '...',
          timestamp: Date.now(),
          thinking: data.thinking,
          input_tokens: data.input_tokens,
          output_tokens: data.output_tokens,
          cache_read_tokens: data.cache_read_tokens,
          cache_creation_tokens: data.cache_creation_tokens,
          request_audit: data.request_audit,
          tool_calls: data.tool_calls,
          content_blocks: data.content_blocks,
          bubbleLayout: data.bubbleLayout,
          ccAttemptId: data.ccAttemptId,
          ccSessionFingerprint: data.ccSessionFingerprint,
          ccSessionMode: data.ccSessionMode,
          ccSessionReason: data.ccSessionReason,
          ccCompacted: data.ccCompacted,
          replyMode: data.replyMode,
          providerId: retryRoute === 'claude-code' ? 'claude-code' : profile?.id,
          modelId: retryRoute === 'claude-code' ? (ccStatus.model || 'sonnet') : model,
        }
        if (nextMsg?.role === 'assistant') {
          addMessageVersion(nextMsg.id, reply, activeSession?.id)
          void syncChatNow()
        } else {
          const assistantMsg: ChatMessage = { id: `${Date.now()}-reroll`, role: 'assistant', ...reply }
          await durableAppend(activeSession, assistantMsg)
          addMessage(assistantMsg, activeSession?.id)
        }
        if (retryRoute === 'claude-code') updateMessage(msg.id, { ccGenerationState: 'settled' })
        void syncChatNow()
        setIsLoading(false)
        setStreamText('')
        setStreamThinking('')
        setStreamBlocks([])
      }, normalizeReplyMode(msg.replyMode), retryRoute, retryTurnId, retryRoute === 'claude-code' && !recoverPending ? 'rebase' : undefined)
    }
  }

  // If a tab refreshed or iOS suspended the PWA after the user message was
  // saved, re-submit the same turn id. The gateway's idempotency ledger either
  // reconnects to the running attempt or replays its one completed result.
  useEffect(() => {
    if (!mounted || isLoading || !ccStatus.available || !activeSession?.id) return
    const pending = [...messages].reverse().find(message => message.role === 'user' && message.route === 'claude-code' && message.ccGenerationState === 'pending')
    if (!pending || messages.at(-1)?.id !== pending.id) return
    const key = `${activeSession.id}:${pending.id}`
    if (recoveredTurnsRef.current.has(key)) return
    recoveredTurnsRef.current.add(key)
    void handleRetry(pending, true, true)
    // Recovery is keyed to the durable turn, not ordinary streaming renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, activeSession?.id, ccStatus.available, isLoading, messages.at(-1)?.id, messages.at(-1)?.ccGenerationState])

  /* ── delete message ───────────────────── */

  /* ── delete with options ───────────────── */
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
  const finishEditMsg = async () => {
    if (!editingMsgId) return
    const msg = messages.find(m => m.id === editingMsgId)
    const nextText = editingMsgText.trim()
    setEditingMsgId(null)
    setEditingMsgText('')
    if (msg && nextText && nextText !== msg.content) {
      const editedBlocks: ContentBlock[] | undefined = msg.role === 'assistant' && msg.replyMode === 'short' ? [{ type: 'text', content: nextText }] : undefined
      const newVersion: MessageVersion = {
        route: normalizeChatRoute(msg.route),
        content: nextText,
        replyMode: msg.replyMode,
        content_blocks: editedBlocks,
        bubbleLayout: editedBlocks ? composeBubbleLayout(editedBlocks) : undefined,
        timestamp: Date.now(),
        providerId: msg.providerId,
        modelId: msg.modelId,
      }
      addMessageVersion(msg.id, newVersion, activeSession?.id)
      void syncChatNow()
      const regenerate = await ask('已保存修改。要按新内容重新生成后面的回复吗？')
      if (regenerate) await handleRetry({ ...msg, ...newVersion }, true)
    }
  }

  /* ── key handling ─────────────────────── */

  const toggleThinking = (id: string) => {
    setExpandedThinking(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }
  const toggleTools = (id: string) => {
    setExpandedTools(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }

  const handleStopGeneration = async () => {
    const current = activeGenerationRef.current
    if (!current || current.route === 'api') {
      explicitStopRef.current = true
      abortControllerRef.current?.abort()
      return
    }
    let cancelled: { ok: boolean; attempt?: { id: string; status: string } } | null = null
    for (let attempt = 0; attempt < 3 && !cancelled; attempt++) {
      try { cancelled = await chatApi.cancelCcAttempt({ session_id: current.sessionId, turn_id: current.turnId }) }
      catch {
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)))
      }
    }
    if (!cancelled) {
      window.alert('暂时没能把取消指令送到 CC。任务可能仍在后台继续，我没有假装它已经停下。')
      return
    }
    if (cancelled.attempt?.status === 'completed') return
    explicitStopRef.current = true
    abortControllerRef.current?.abort()
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
  const aColor = n ? ap.aiBubbleColorNight : ap.aiBubbleColor
  const userBubbleStyle = bubbleAppearance(ap, 'user', n)
  const aiBubbleStyle = bubbleAppearance(ap, 'ai', n)

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
      <div className="shrink-0 border-t border-current/5 p-2 space-y-2">
        <section className={`rounded-xl border p-3 ${n ? 'border-night-border bg-night-surface/45' : 'border-day-border bg-day-tint/65'}`}>
          <div className="flex items-center justify-between text-[10px] tracking-[0.16em] opacity-55">
            <span>CC 额度 · 订阅</span>
            <button type="button" aria-label="刷新 CC 状态" onClick={() => void refreshCcStatus()} className="p-1 -m-1 hover:opacity-100">
              <RotateCcw size={13} />
            </button>
          </div>
          <div className="mt-1.5 flex items-end justify-between gap-2">
            <div className="text-xl leading-none">暂不可读</div>
            <span className={`text-[10px] ${ccStatus.available ? (n ? 'text-night-amber' : 'text-emerald-700') : 'text-red-500'}`}>
              {ccStatus.available ? '● 线路在线' : '● 线路离线'}
            </span>
          </div>
          <div className="mt-2 text-[10px] leading-relaxed opacity-45">官方暂未向安全的后台模式开放五小时/七天额度。</div>
        </section>

        <section className={`rounded-xl border p-3 ${n ? 'border-night-border bg-night-surface/45' : 'border-day-border bg-day-tint/65'}`}>
          <div className="flex items-center justify-between text-[10px] tracking-[0.16em] opacity-55">
            <span>CC CONTEXT · 当前对话</span>
            <span className={ccStatus.context.available ? (n ? 'text-night-amber' : 'text-emerald-700') : ''}>●</span>
          </div>
          {ccStatus.context.available ? (
            <>
              <div className="mt-1.5 text-[25px] leading-none tabular-nums">{fmtTokens(ccStatus.context.usedTokens)} / {fmtTokens(ccStatus.context.maxTokens)}</div>
              <div className="mt-2 flex justify-between text-[10px] opacity-50">
                <span>上下文水位 · {ccStatus.context.usedPercentage ?? '—'}%</span>
                <span>{fmtMetricTime(ccStatus.context.collectedAt)}</span>
              </div>
              <div className={`mt-1.5 h-1 overflow-hidden rounded-full ${n ? 'bg-night-card' : 'bg-black/5'}`}>
                <div className={`h-full rounded-full ${n ? 'bg-night-amber' : 'bg-day-pink'}`} style={{ width: `${Math.min(100, ccStatus.context.usedPercentage || 0)}%` }} />
              </div>
              <div className="mt-2 flex justify-between gap-2 text-[10px] opacity-45">
                <span>读缓存 {fmtTokens(ccStatus.context.cacheReadTokens)} · 写缓存 {fmtTokens(ccStatus.context.cacheCreationTokens)}</span>
                <span className="truncate">{ccStatus.context.model || ccStatus.model || 'CC'}</span>
              </div>
            </>
          ) : (
            <>
              <div className="mt-1.5 text-xl leading-none">等待首条 CC 回复</div>
              <div className="mt-2 text-[10px] opacity-45">这张卡只读取真实 session 用量，不估算。</div>
            </>
          )}
        </section>
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
            <div className="flex items-center gap-3"><SyncBadge /><button aria-label="打开聊天菜单" onClick={() => setSettingsOpen(true)} className={`p-2 rounded-xl transition ${n ? 'hover:bg-night-surface text-night-muted' : 'hover:bg-gray-100 text-day-muted'}`}>
              <Settings2 size={16} />
            </button></div>
          </div>}

          {/* mobile header */}
          {!embedded && <div className="md:hidden flex justify-between items-center px-4 pt-3 pb-1">
            <button onClick={() => setSessionDrawerOpen(true)} className={`p-2 rounded-xl ${n ? 'bg-night-card/80 text-night-muted' : 'bg-white/80 text-day-muted'} backdrop-blur-md`}>
              <PanelLeft size={16} />
            </button>
            <button aria-label="打开聊天菜单" onClick={() => setSettingsOpen(true)} className={`p-2 rounded-xl ${n ? 'bg-night-card/80 text-night-muted' : 'bg-white/80 text-day-muted'} backdrop-blur-md`}>
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

            {(hiddenCount > 0 || serverHiddenCount > 0) && (
              <div className="flex justify-center pb-2">
                <button onClick={() => void handleLoadEarlier()} disabled={historyLoading}
                  className={`text-[11px] px-3 py-1.5 rounded-full opacity-60 hover:opacity-100 ${n ? 'bg-night-surface' : 'bg-gray-100'}`}>
                  {historyLoading ? '加载中…' : `加载更早的 ${Math.min(CHAT_PAGE_SIZE, hiddenCount || serverHiddenCount)} 条（还有 ${hiddenCount + serverHiddenCount} 条）`}
                </button>
              </div>
            )}

            <div>
              {visibleMessages.map((msg) => {
                const isUser = msg.role === 'user'
                const versions = msg.versions || []
                const vIdx = msg.versionIndex ?? 0
                const hasVersions = versions.length > 1
                const isEditing = editingMsgId === msg.id
                const baseDisplayBlocks: ContentBlock[] | undefined = !isUser
                  ? (msg.content_blocks?.length ? msg.content_blocks : (msg.replyMode === 'short' && msg.content.trim() ? [{ type: 'text', content: msg.content }] : undefined))
                  : undefined
                const displayContentBlocks = baseDisplayBlocks
                  ? (msg.replyMode === 'short' ? applyBubbleLayout(baseDisplayBlocks, msg.bubbleLayout || composeBubbleLayout(baseDisplayBlocks)) : baseDisplayBlocks)
                  : undefined
                const lastTextBlock = displayContentBlocks?.reduce((last, block, index) => block.type === 'text' && block.content?.trim() ? index : last, -1) ?? -1

                return (
                  <div key={msg.id} className="flex mb-4">
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
                      {!isUser && displayContentBlocks && displayContentBlocks.length > 0 ? (
                        <>
                          {displayContentBlocks.map((block: ContentBlock, bi: number) => {
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
                                <div key={blockKey} className={`block w-fit max-w-[87%] mr-auto break-words px-4 py-3 rounded-2xl ${bi === lastTextBlock ? 'rounded-bl-md' : ''} text-[14px] leading-relaxed ${!aColor ? (n ? 'bg-night-surface text-night-text' : 'bg-white shadow-sm text-day-text') : ''}`}
                                  style={aiBubbleStyle}>
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
                      ) : ((isUser || !displayContentBlocks || displayContentBlocks.length === 0) && (msg.content.trim() || (msg.images?.length || 0) > 0 || !!msg.sharedCard)) ? (
                        <div className={`block break-words px-4 py-3 rounded-2xl text-[14px] leading-relaxed  ${isUser ? 'w-fit max-w-[80%] rounded-br-md ml-auto' : 'w-fit max-w-[87%] rounded-bl-md mr-auto'} ${(isUser ? !uColor : !aColor) ? (isUser ? (n ? 'bg-night-amber/20 text-night-text' : 'bg-day-honey text-day-text') : (n ? 'bg-night-surface text-night-text' : 'bg-white shadow-sm text-day-text')) : ''}`}
                          style={isUser ? userBubbleStyle : aiBubbleStyle}>
                          {msg.sharedCard && (
                            <div className={`mb-2 rounded-xl border overflow-hidden ${n ? 'border-night-amber/30 bg-night-surface/70' : 'border-day-pink/20 bg-white/70'}`}>
                              <div className="px-3 py-2 text-xs font-medium">📎 {msg.sharedCard.title}</div>
                              {msg.sharedCard.imageUrl && <img src={msg.sharedCard.imageUrl} alt="" className="w-full max-h-48 object-contain" />}
                              <div className="px-3 pb-2 text-[11px] whitespace-pre-wrap">{msg.sharedCard.subtitle}{msg.sharedCard.body ? `\n${msg.sharedCard.body}` : ''}</div>
                            </div>
                          )}
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
                          <span className="opacity-40">{chatRouteLabel(msg.route)}{msg.modelId ? ` · ${msg.modelId}` : ''}</span>
                          {msg.ccSessionFingerprint && <span className="opacity-35" title={`${msg.ccSessionMode || 'session'} · ${msg.ccSessionReason || 'normal'}${msg.ccCompacted ? ' · compacted' : ''}`}>会话 {msg.ccSessionFingerprint}{msg.ccCompacted ? ' · 已整理' : ''}</span>}
                          {(msg.input_tokens != null && msg.input_tokens > 0) && (() => {
                            const inp = msg.input_tokens || 0
                            const out = msg.output_tokens || 0
                            const cr = msg.cache_read_tokens || 0
                            const cw = msg.cache_creation_tokens || 0
                            const ratio = (inp + cr + cw) > 0 ? Math.round((cr / (inp + cr + cw)) * 100) : 0
                            return (
                              <button type="button" onClick={() => setReceiptMessage(msg)} className="opacity-60 hover:opacity-100 underline decoration-dotted underline-offset-2" title={`查看上下文小票：输入${inp} · 输出${out} · 缓存命中${ratio}%`}>
                                ↑{inp.toLocaleString()}・↓{out.toLocaleString()}
                                {cr > 0 && <span className={n ? 'text-night-amber' : 'text-day-pink'}>・⚡️{ratio}%</span>}
                              </button>
                            )
                          })()}
                        </div>
                      )}

                      {/* action buttons */}
                      <div className={`flex items-center gap-1 ${isUser ? 'justify-end' : 'justify-start'} opacity-40 hover:opacity-100 transition-opacity relative`}>
                        <button onClick={() => handleRetry(msg, false, msg.ccGenerationState === 'pending')} title="重试" className="p-1"><RotateCcw size={12} /></button>
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
                  </div>
                )
              })}
            </div>

            {/* loading / streaming */}
            {isLoading && (
              <StreamingReply
                blocks={streamBlocks}
                expandedThinking={expandedThinking}
                onToggleThinking={toggleThinking}
                isNight={n}
                aiColor={aColor}
                aiBubbleStyle={aiBubbleStyle}
              />
            )}

            <div ref={messagesEndRef} />
          </div>


          {/* footer */}
          <div className={`p-4 border-t backdrop-blur-md ${n ? 'border-night-border bg-night-card/50' : 'border-day-muted/10 bg-white/50'} pb-[max(1rem,env(safe-area-inset-bottom))] relative`}>
            {/* pending shared card */}
            {pendingShare && (
              <div className={`mx-1 mb-2 rounded-xl border overflow-hidden ${n ? 'border-night-amber/30 bg-night-surface' : 'border-day-pink/20 bg-white'}`}>
                <div className="flex items-center justify-between px-3 py-2 text-xs">
                  <span>📎 已带入 {pendingShare.title}</span>
                  <button onClick={() => setPendingShare(null)} className="opacity-50"><X size={14} /></button>
                </div>
                <div className="px-3 pb-2 text-[11px] space-y-1">
                  {pendingShare.imageUrl && <img src={pendingShare.imageUrl} alt="" className="w-full max-h-40 object-contain rounded-lg" />}
                  <div className="font-medium">{pendingShare.subtitle}</div>
                  <div className="whitespace-pre-wrap opacity-70">{pendingShare.body}</div>
                  <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all opacity-45">{JSON.stringify(pendingShare.metadata, null, 2)}</pre>
                </div>
              </div>
            )}
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

            <ChatRouteChip
              profileName={activeProfile?.name}
              modelName={activeModel?.name || activeModel?.id || settings.model}
              route={activeRoute}
              ccStatus={ccStatus}
              isNight={n}
              onClick={() => setModelPickerOpen(true)}
            />

            {/* input area */}
            <div className={`chat-input-tray flex items-end gap-2 px-3 py-2 rounded-2xl border transition-all duration-200 ${n ? 'bg-night-surface/95 border-night-border/80 shadow-[0_8px_24px_rgba(0,0,0,0.22)] focus-within:border-night-amber/50 focus-within:shadow-[0_10px_30px_rgba(226,168,75,0.10)]' : 'bg-[#fffaf7]/95 border-day-muted/10 shadow-[0_8px_24px_rgba(93,64,55,0.10)] focus-within:border-day-pink/35 focus-within:shadow-[0_10px_30px_rgba(239,64,103,0.10)]'}`}>
              <textarea aria-label="聊天输入" ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
                placeholder={inputPlaceholder} rows={1} enterKeyHint="enter"
                className={`no-frame flex-1 min-w-0 resize-none bg-transparent outline-none text-base md:text-sm py-1 max-h-40 ${n ? 'text-night-text placeholder:text-night-muted' : 'text-day-text placeholder:text-day-muted'}`} />
              <input ref={imgInputRef} type="file" accept="image/*" hidden onChange={handleUploadImage} />
              <button aria-label="更多功能" aria-expanded={moreOpen} onClick={() => setMoreOpen(v => !v)} className="p-2 rounded-xl flex-shrink-0 relative"><Plus size={18}/>{timelineCurrent && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-day-pink"/>}</button>
              {isLoading ? (
                <button onClick={() => { void handleStopGeneration() }} title="停止生成"
                  className={`p-2 rounded-xl transition-all flex-shrink-0 ${n ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'}`}>
                  <Square size={15} fill="currentColor" />
                </button>
              ) : (
                <button aria-label="发送消息" onClick={handleSend} disabled={!input.trim() && pendingImages.length === 0 && !pendingShare}
                  className={`p-2 rounded-xl transition-all flex-shrink-0 ${(input.trim() || pendingImages.length || pendingShare) ? (n ? 'bg-night-amber text-night-bg hover:bg-night-amberGlow' : 'bg-day-pink text-white hover:bg-day-pink/80') : 'opacity-30 cursor-not-allowed'}`}>
                  <Send size={16} />
                </button>
              )}
            </div>

            {moreOpen && <div className="grid grid-cols-2 gap-2 pt-3" aria-label="更多功能">
              <button disabled={uploadingImg} onClick={() => imgInputRef.current?.click()} className="flex items-center justify-center gap-2 rounded-xl bg-black/5 p-3 text-xs"><ImagePlus size={16}/>{uploadingImg ? '处理中…' : '上传照片'}</button>
              <button onClick={() => setTimelineOpen(true)} className="flex items-center justify-center gap-2 rounded-xl bg-black/5 p-3 text-xs min-w-0"><Clock3 size={16}/><span className="truncate">{timelineCurrent ? `${timelineCurrent.title} · ${timelineElapsedText}` : 'Timeline'}</span></button>
              <div role="group" aria-label="对话模式" className="col-span-2 flex gap-2 rounded-xl bg-black/5 p-1">
                {(['long', 'short'] as const).map(mode => <button key={mode} aria-pressed={normalizeReplyMode(activeSession?.conversationMode) === mode} onClick={() => activeSession && setConversationMode(activeSession.id, mode)} className={`flex-1 rounded-lg py-2.5 text-xs transition ${normalizeReplyMode(activeSession?.conversationMode) === mode ? (n ? 'bg-night-amber/20 text-night-amber' : 'bg-white text-day-pink shadow-sm') : 'opacity-60'}`}>{mode === 'long' ? '长聊' : '短聊'}</button>)}
              </div>
            </div>}

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

          <ChatRoutePicker
            open={modelPickerOpen}
            isNight={n}
            choices={enabledModels}
            activeProfileId={settings.activeProfileId}
            activeModelId={settings.model}
            activeRoute={activeRoute}
            ccStatus={ccStatus}
            onSelectApiModel={(profileId, modelId) => {
              if (activeSession) setGenerationRoute(activeSession.id, 'api')
              setActiveModel(profileId, modelId)
              setModelPickerOpen(false)
            }}
            onSelectCc={() => {
              if (activeSession && ccStatus.available) setGenerationRoute(activeSession.id, 'claude-code')
              setModelPickerOpen(false)
            }}
            onClose={() => setModelPickerOpen(false)}
          />

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
          <ChatSettings onSummary={() => setSummaryDialogOpen(true)} onBookmarks={() => setBookmarkDialogOpen(true)} onCoupons={() => window.dispatchEvent(new CustomEvent('lumbre-open-coupons'))} onModelPicker={() => setModelPickerOpen(true)} onModelManager={() => setModelDialogOpen(true)} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          <ModelDialog open={modelDialogOpen} onClose={() => setModelDialogOpen(false)} />
          <SummaryDialog open={summaryDialogOpen} onClose={() => setSummaryDialogOpen(false)} session={activeSession} generating={summaryGenerating} stageGenerating={stageSummaryGenerating} error={summaryError} onGenerate={() => { summaryAttemptRef.current = ''; void generateNextSummary(false) }} onRegenerate={(summary) => { void regenerateSummary(summary) }} />
          <BookmarkDialog open={bookmarkDialogOpen} onClose={() => setBookmarkDialogOpen(false)} />
          <TimelineTimerModal open={timelineOpen} current={timelineCurrent} onClose={() => setTimelineOpen(false)} onChanged={() => refreshTimelineCurrent()} />
          <MessageReceiptDialog message={receiptMessage} settings={settings} night={n} onClose={() => setReceiptMessage(null)} />
        </>,
        document.body,
      )}


    </>
  )
}
