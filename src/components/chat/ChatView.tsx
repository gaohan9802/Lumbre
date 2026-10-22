'use client'

import { Fragment, useEffect, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '@/lib/theme'
import { useApp } from '@/lib/store'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send, ChevronDown, ChevronLeft, ChevronRight, Menu, Moon, Sun, MoreHorizontal,
  Plus, Pin, Trash2, Pencil, X, Copy, Check, RotateCcw, ImagePlus, Paperclip, Clock3, Square, Dices, Heart,
} from 'lucide-react'
import {
  useChatStore, ChatMessage, MessageVersion, ContentBlock, snapshotOfMessage,
  getActiveProfile, getEnabledModels, getSortedSessions, getTriggeredBookmarks, ChatSummary, StageSummary,
} from '@/lib/chatStore'
import { apiRequest, pencilDrawings as pencilDrawingsApi, photos as photosApi } from '@/lib/api'
import { compressImage } from '@/lib/image'
import type { SharedCard } from '@/lib/share'
import { ChatSettings, type ChatSettingsPanel } from './ChatSettings'
import { composeBubbleLayout } from '@/lib/chat-bubble-composer'
import { ModelDialog } from './ModelDialog'
import { BookmarkDialog } from './BookmarkDialog'
import { SummaryDialog } from './SummaryDialog'
import { ChatWindowSettings } from './ChatWindowSettings'
import { MessageReceiptDialog } from './MessageReceiptDialog'
import { TimelineTimerModal } from '@/components/timeline/TimelineTimerModal'
import { MarkdownText } from './MarkdownText'
import { APP_TIME_ZONE, formatMadrid, madridDateKey, madridDayBounds } from '@/lib/madrid-time'
import { buildSummaryRounds, selectLoadedSessionSummarySegment } from '@/lib/chat-summary'
import { chatApi, type CcStatus } from '@/features/chat/api/client'
import { readChatEventStream } from '@/features/chat/api/event-stream'
import { timeline as timelineApi } from '@/lib/api'
import { loadEarlierChat, syncChatNow } from '@/features/chat/sync/ChatSync'
import { flushChatOutbox, queueChatAppend } from '@/features/chat/sync/outbox'
import { CHAT_PAGE_SIZE, useChatViewState } from '@/features/chat/view/useChatViewState'
import { prepareChatMessage, type PencilDrawingResult } from '@/features/chat/view/prepareChatMessage'
import { toolDisplayInput, toolDisplayLabel } from '@/features/chat/tool-display'
import { StreamingReply } from '@/features/chat/components/StreamingReply'
import { ThinkingDrawer } from '@/features/chat/components/ThinkingDrawer'
import { ChatRouteChip, ChatRoutePicker } from '@/features/chat/components/ChatRoutePicker'
import { chatRouteLabel, isRecoverableChatDisconnect, normalizeChatRoute, type ChatRoute } from '@/lib/chat-route'
import { ccContextLevel } from '@/lib/chat-window-config'
import { CC_MODELS, DEFAULT_CC_MODEL, isCcModel, normalizeCcEffortForModel } from '@/lib/cc-model'
import { ccSystemPromptForModel } from '@/lib/cc-system-prompt'
import { chatMessageContentForModel, isSupportedChatFile, MAX_CHAT_ATTACHMENTS, MAX_CHAT_ATTACHMENT_BYTES } from '@/lib/chat-message-sync'
import { measureReceiptText } from '@/lib/chat-receipt'
import { IntimacyWheelModal } from './IntimacyWheelModal'
import { TodoView } from '@/components/todo/TodoView'
import { useWeather, weatherEmoji } from '@/lib/useWeather'
import dynamic from 'next/dynamic'

const TimelineView = dynamic(() => import('@/components/timeline/TimelineView').then(module => module.TimelineView), { ssr: false })
const TesisView = dynamic(() => import('@/components/tesis/TesisView').then(module => module.TesisView), { ssr: false })
const NotesView = dynamic(() => import('@/components/notes/NotesView').then(module => module.NotesView), { ssr: false })
const DiaryView = dynamic(() => import('@/components/diary/DiaryView').then(module => module.DiaryView), { ssr: false })
const PhotosView = dynamic(() => import('@/components/photos/PhotosView').then(module => module.PhotosView), { ssr: false })
const PoemsView = dynamic(() => import('@/components/poems/PoemsView').then(module => module.PoemsView), { ssr: false })
const StoriesView = dynamic(() => import('@/components/stories/StoriesView').then(module => module.StoriesView), { ssr: false })
const ResearchView = dynamic(() => import('@/components/research/ResearchView').then(module => module.ResearchView), { ssr: false })
const DreamsView = dynamic(() => import('@/components/dreams/DreamsView').then(module => module.DreamsView), { ssr: false })
const WishlistView = dynamic(() => import('@/components/wishlist/WishlistView').then(module => module.WishlistView), { ssr: false })
const MediaLibraryView = dynamic(() => import('@/components/media/MediaLibraryView').then(module => module.MediaLibraryView), { ssr: false })
const EnergyView = dynamic(() => import('@/components/energy/EnergyView').then(module => module.EnergyView), { ssr: false })
const MemoryView = dynamic(() => import('@/components/memory/MemoryView').then(module => module.MemoryView), { ssr: false })
const FavoritesView = dynamic(() => import('@/components/favorites/FavoritesView').then(module => module.FavoritesView), { ssr: false })
const FutureLetterView = dynamic(() => import('@/components/future-letter/FutureLetterView').then(module => module.FutureLetterView), { ssr: false })
const FireDictionaryView = dynamic(() => import('@/components/dictionary/FireDictionaryView').then(module => module.FireDictionaryView), { ssr: false })

type RoomPanel = 'notes' | 'diary' | 'photos' | 'poems' | 'stories' | 'research' | 'future' | 'dictionary' | 'wake' | 'memory' | 'favorites' | 'wishlist' | 'media' | 'energy' | 'timeline' | 'tesis'
const roomLabels: Record<RoomPanel, string> = { notes: '小纸条', diary: '日记', photos: '照片', poems: '共诗', stories: '枕边集', research: '星野手记', future: '醒来以后', dictionary: '小火辞典', wake: '心跳唤醒', memory: '记忆', favorites: '收藏夹', wishlist: '愿望清单', media: '书影记录', energy: '能量手账', timeline: 'Timeline', tesis: 'Tesis' }

interface FavoriteSourceItem {
  kind: 'memory' | 'diary' | 'chat'
  targetKey: string
  metadata: Record<string, unknown>
}

interface FavoriteChatContext {
  sessionId: string
  sessionTitle: string
  targetIndex: number
  total: number
  targetMessageId: string
  messages: ChatMessage[]
}

/* ── helpers ────────────────────────────── */

const fmtFullTs = (ts: number) => {
  try { return formatMadrid(Number(ts) || Date.now()) } catch { return '' }
}

const madridDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE })
const madridTimeFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false })
const madridShortDateFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: APP_TIME_ZONE, month: 'short', day: 'numeric' })

const fmtShortDate = (ts: number) => {
  const d = new Date(ts)
  if (madridDateFormatter.format(d) === madridDateFormatter.format(new Date())) return madridTimeFormatter.format(d)
  return madridShortDateFormatter.format(d)
}

function TimelineButton({ current, onClick }: { current: import('@/components/timeline/TimelineTimerModal').TimelineCurrent | null; onClick: () => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!current) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [current?.id, current?.start_at])
  const elapsed = current ? Math.max(0, Math.floor((now - new Date(current.start_at).getTime()) / 1000)) : 0
  const elapsedText = `${String(Math.floor(elapsed / 3600)).padStart(2, '0')}:${String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`
  return (
    <button type="button" aria-label="打开 Timeline" title={current ? `${current.title} · ${elapsedText}` : 'Timeline'} onClick={onClick} className="chat-theme-icon relative grid h-8 w-8 place-items-center rounded-full">
      <Clock3 size={17}/>{current && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[#DBB9B3]"/>}
    </button>
  )
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

const fmtMetricReset = (value?: string | null) => {
  if (!value) return '—'
  return new Date(value).toLocaleString('zh-CN', { timeZone: APP_TIME_ZONE, month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
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

function toModelMessage(message: ChatMessage) {
  return {
    id: message.id,
    role: message.role,
    route: normalizeChatRoute(message.route),
    ccAttemptId: message.ccAttemptId,
    content: chatMessageContentForModel(message),
    images: message.images,
    timestamp: message.timestamp,
  }
}

/* ── image compression ──────────────────────
 * 手机原图常是 HEIC/超大 JPEG，直接塞进 vision 请求会因格式不支持或超过
 * 5MB 上限被上游拒绝 → 回复被截断/为空。统一压成 ≤1568px 的 JPEG。 */
/* ── main component ─────────────────────── */

export interface ChatViewProps {
  embedded?: boolean
  contextInjection?: string
  title?: string
  inputPlaceholder?: string
  onTurn?: (role: 'user' | 'assistant', content: string) => void
}

export function ChatView({ embedded = false, contextInjection = '', inputPlaceholder = '', onTurn }: ChatViewProps = {}) {
  const { setSidebarOpen, currentUser } = useApp()
  const { theme, toggle: toggleTheme } = useTheme()
  const { data: weather, refreshing: locationRefreshing, error: locationError, refresh: refreshLocation } = useWeather()
  const n = theme === 'night'
  const [wheelOpen, setWheelOpen] = useState(false)
  const [todoOpen, setTodoOpen] = useState(false)
  const [roomPanel, setRoomPanel] = useState<RoomPanel | null>(null)
  const [chatSettingsPanel, setChatSettingsPanel] = useState<ChatSettingsPanel>('menu')
  const [ccRefreshing, setCcRefreshing] = useState(false)
  const [windowSettingsOpen, setWindowSettingsOpen] = useState(false)
  const [contextWarning, setContextWarning] = useState<{ sessionId: string; level: 85 | 95 } | null>(null)
  const [sessionActionsId, setSessionActionsId] = useState<string | null>(null)
  const [nosePokes, setNosePokes] = useState<{ id: string; timestamp: number; sessionId: string }[]>([])
  const [nosePokeBusy, setNosePokeBusy] = useState(false)
  const [favoriteChatKeys, setFavoriteChatKeys] = useState<Set<string>>(new Set())
  const [favoriteChatContext, setFavoriteChatContext] = useState<FavoriteChatContext | null>(null)
  const [savedDrawings, setSavedDrawings] = useState<Set<string>>(new Set())
  const [thinkingDrawer, setThinkingDrawer] = useState<{ id: string; parts: string[] } | null>(null)
  const {
    messages, settings,
    addMessage, updateMessage, createSession, setActiveSession, setSettings,
    renameSession, deleteSession, togglePinSession,
    setGenerationRoute, setCcModel, setWindowConfig, setCcContextState, deleteMessage, addMessageVersion, switchMessageVersion, deleteMessageVersion, continueSession, addSummary, updateSummary, addStageSummary, updateStageSummary,
  } = useChatStore()
  const enabledModels = getEnabledModels(settings)
  const sessions = getSortedSessions(settings)
  const activeSession = settings.sessions.find((s) => s.id === settings.activeSessionId)
  const activeRoute = normalizeChatRoute(activeSession?.generationRoute)
  const [ccStatus, setCcStatus] = useState<CcStatus>(EMPTY_CC_STATUS)
  const selectedCcModel = isCcModel(activeSession?.ccModel) ? activeSession.ccModel : undefined
  const activeCcModel = selectedCcModel || (isCcModel(ccStatus?.model) ? ccStatus.model : DEFAULT_CC_MODEL)
  const effectiveCcModel = selectedCcModel || ccStatus.model || DEFAULT_CC_MODEL
  const activeApiProfile = settings.apiProfiles.find(profile => profile.id === activeSession?.windowConfig?.apiProfileId)
    || getActiveProfile(settings)
  const activeApiModel = activeApiProfile?.models.some(model => model.id === activeSession?.windowConfig?.apiModelId)
    ? activeSession?.windowConfig?.apiModelId || settings.model
    : activeApiProfile?.id === settings.activeProfileId ? settings.model : activeApiProfile?.defaultModel || settings.model
  const activeCcEffort = activeSession?.windowConfig?.ccEffort || settings.ccEffort
  const currentContextLevel = ccContextLevel(ccStatus.context.usedPercentage)
  const [receiptMessage, setReceiptMessage] = useState<ChatMessage | null>(null)
  const [ccRecoveryTick, setCcRecoveryTick] = useState(0)
  const bottomedSessionRef = useRef<string | null>(null)
  const footerRef = useRef<HTMLDivElement>(null)
  const [footerInset, setFooterInset] = useState(112)

  const {
    input, setInput, isLoading, setIsLoading, sendStarting, setSendStarting,
    streamText, setStreamText, streamBlocks, setStreamBlocks,
    expandedTools, setExpandedTools,
    settingsOpen, setSettingsOpen, modelDialogOpen, setModelDialogOpen,
    bookmarkDialogOpen, setBookmarkDialogOpen, summaryDialogOpen, setSummaryDialogOpen,
    summaryGenerating, setSummaryGenerating, summaryError, setSummaryError, summaryGeneratingRef, summaryAttemptRef,
    stageSummaryGenerating, setStageSummaryGenerating, stageAttemptRef,
    timelineOpen, setTimelineOpen, timelineCurrent, setTimelineCurrent,
    sessionDrawerOpen, setSessionDrawerOpen, modelPickerOpen, setModelPickerOpen,
    editingSessionId, setEditingSessionId,
    editingTitle, setEditingTitle, editingMsgId, setEditingMsgId, editingMsgText, setEditingMsgText,
    copiedId, setCopiedId, mounted, setMounted,
    uploadingImg, setUploadingImg, pendingImages, setPendingImages, pendingAttachments, setPendingAttachments, pendingShare, setPendingShare,
    visibleCount, setVisibleCount, historyLoading, setHistoryLoading, photoPrompt, setPhotoPrompt,
    deleteMenuId, setDeleteMenuId, messageActionsId, setMessageActionsId,
    messagesEndRef, inputRef, imgInputRef, fileInputRef, scrollRef, stickBottomRef, abortControllerRef,
    activeGenerationRef, explicitStopRef, recoveredTurnsRef, sendLockRef,
    confirmState, ask, answer,
  } = useChatViewState(settings.activeSessionId || '__new__')

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    if (thinkingDrawer?.id !== 'stream') return
    const parts = streamBlocks
      .filter((block): block is ContentBlock & { content: string } => block.type === 'thinking' && typeof block.content === 'string' && !!block.content.trim())
      .map(block => block.content)
    if (parts.length > 0) setThinkingDrawer(current => current?.id === 'stream' ? { ...current, parts } : current)
  }, [streamBlocks, thinkingDrawer?.id])
  useEffect(() => {
    apiRequest('/api/favorites?kind=chat').then((items: any[]) => setFavoriteChatKeys(new Set((Array.isArray(items) ? items : []).map(item => item.targetKey)))).catch(() => {})
  }, [])
  useEffect(() => {
    const openSource = async (event: Event) => {
      const item = (event as CustomEvent<FavoriteSourceItem>).detail
      if (!item || !['memory', 'diary', 'chat'].includes(item.kind)) return
      if (item.kind !== 'chat') {
        try { sessionStorage.setItem('lumbre-favorite-source', JSON.stringify(item)) } catch {}
        setRoomPanel(item.kind)
        return
      }
      const sessionId = typeof item.metadata?.sessionId === 'string' ? item.metadata.sessionId : ''
      const messageId = typeof item.metadata?.messageId === 'string' ? item.metadata.messageId : ''
      if (!sessionId || !messageId) return window.alert('这条旧收藏没有保存原聊天位置，快照仍然可以正常阅读。')
      try {
        const params = new URLSearchParams({ mode: 'message-context', id: sessionId, messageId })
        const context = await apiRequest(`/api/sync?${params}`)
        const state = useChatStore.getState()
        if (state.settings.sessions.some(session => session.id === sessionId)) state.setActiveSession(sessionId)
        setFavoriteChatContext({ ...context, targetMessageId: messageId })
        setRoomPanel(null)
      } catch (sourceError: any) {
        window.alert(sourceError?.message || '原聊天已不存在，收藏快照仍然保留。')
      }
    }
    window.addEventListener('lumbre-open-favorite-source', openSource)
    return () => window.removeEventListener('lumbre-open-favorite-source', openSource)
  }, [])
  useEffect(() => {
    const sessionId = activeSession?.id
    setNosePokes([])
    if (!sessionId) return
    let cancelled = false
    fetch(`/api/nose-pokes?sessionId=${encodeURIComponent(sessionId)}`, { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then(data => { if (!cancelled && Array.isArray(data?.events)) setNosePokes(data.events) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [activeSession?.id])
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const scheduleReset = () => {
      const [, tomorrow] = madridDayBounds(madridDateKey())
      timer = setTimeout(() => {
        setNosePokes([])
        scheduleReset()
      }, Math.max(1_000, new Date(tomorrow).getTime() - Date.now() + 1_000))
    }
    scheduleReset()
    return () => clearTimeout(timer)
  }, [])

  const pokeLeopardNose = async () => {
    const sessionId = activeSession?.id
    if (nosePokeBusy || !sessionId) return
    setNosePokeBusy(true)
    const optimisticPoke = { id: `pending-${crypto.randomUUID()}`, timestamp: Date.now(), sessionId }
    setNosePokes(current => [...current, optimisticPoke])
    navigator.vibrate?.(12)
    try {
      const response = await fetch('/api/nose-pokes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) })
      if (!response.ok) throw new Error('戳鼻子失败')
      const data = await response.json()
      if (useChatStore.getState().settings.activeSessionId === sessionId && Array.isArray(data.events)) setNosePokes(data.events)
    } catch {
      setNosePokes(current => current.filter(poke => poke.id !== optimisticPoke.id))
      window.alert('豹子刚才躲过去了，再戳一下试试。')
    } finally {
      setNosePokeBusy(false)
    }
  }
  const readCcStatus = useCallback(async () => {
    const status = await chatApi.ccStatus(activeSession?.id)
    setCcStatus(current => ({
      ...status,
      quota: status.quota.available ? status.quota : current.quota.available ? { ...current.quota, stale: true } : status.quota,
    }))
    return status
  }, [activeSession?.id])
  const refreshCcStatus = useCallback(async (showSpinner = true) => {
    if (showSpinner) setCcRefreshing(true)
    try { await readCcStatus() }
    catch {
      setCcStatus(current => ({
        ...current, available: false, toolsAvailable: false,
        quota: current.quota.available ? { ...current.quota, stale: true } : current.quota,
      }))
    }
    finally { if (showSpinner) setCcRefreshing(false) }
  }, [readCcStatus])
  const ensureCcAvailable = useCallback(async (route: ChatRoute, notify = true) => {
    if (route !== 'claude-code') return true
    for (let attempt = 0; attempt < 3; attempt++) {
      try { if ((await readCcStatus()).available) return true } catch {}
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)))
    }
    setCcStatus(current => ({ ...current, available: false }))
    if (notify) {
      window.alert('CC 网关暂时没有连上，消息已留在原对话里；恢复后会自动重试，不会改走 API。')
      setModelPickerOpen(true)
    }
    return false
  }, [readCcStatus, setModelPickerOpen])
  useEffect(() => { void refreshCcStatus() }, [refreshCcStatus])
  useEffect(() => { if (modelPickerOpen) void refreshCcStatus() }, [modelPickerOpen, refreshCcStatus])
  useEffect(() => { setContextWarning(current => current?.sessionId === activeSession?.id ? current : null) }, [activeSession?.id])
  useEffect(() => {
    if (activeRoute !== 'claude-code') return
    const refresh = () => { if (document.visibilityState === 'visible') void refreshCcStatus(false) }
    const timer = setInterval(refresh, !ccStatus.available ? 5_000 : !ccStatus.quota.available ? 30_000 : 60_000)
    window.addEventListener('online', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [activeRoute, ccStatus.available, ccStatus.quota.available, refreshCcStatus])
  useEffect(() => {
    if (!activeSession?.id || activeRoute !== 'claude-code' || !ccStatus.context.available) return
    const level = ccContextLevel(ccStatus.context.usedPercentage)
    const seen = activeSession.ccContextState?.warningLevel || 0
    const justCompacted = Date.now() - Number(activeSession.ccContextState?.lastCompaction?.at || 0) < 15_000
    if (justCompacted) return
    if (level < 70) {
      if (seen) setCcContextState(activeSession.id, current => ({ ...current, warningLevel: undefined }))
      return
    }
    if ((level === 85 || level === 95) && level > seen) {
      setContextWarning({ sessionId: activeSession.id, level })
      setCcContextState(activeSession.id, current => ({ ...current, warningLevel: level }))
    }
  }, [activeRoute, activeSession?.id, activeSession?.ccContextState, ccStatus.context.available, ccStatus.context.usedPercentage, setCcContextState])
  useEffect(() => {
    const accept = (detail: SharedCard | string) => {
      if (typeof detail === 'string') setInput((v) => v ? v + '\n\n' + detail : detail)
      else setPendingShare(detail)
    }
    const onShare = (e: Event) => {
      const detail = (e as CustomEvent<SharedCard | string>).detail
      if (detail) { accept(detail); setRoomPanel(null) }
    }
    try {
      const raw = sessionStorage.getItem('lumbre-pending-share')
      if (raw) { accept(JSON.parse(raw) as SharedCard); sessionStorage.removeItem('lumbre-pending-share') }
    } catch {}
    window.addEventListener('lumbre-share-to-chat', onShare)
    return () => window.removeEventListener('lumbre-share-to-chat', onShare)
  }, [setInput, setPendingShare])
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
  // Lazy-load: only render the most recent messages to keep the window snappy.
  useEffect(() => { setVisibleCount(CHAT_PAGE_SIZE) }, [settings.activeSessionId, setVisibleCount])
  const hiddenCount = Math.max(0, messages.length - visibleCount)
  const serverHiddenCount = activeSession?.partial
    ? Math.max(0, Number(activeSession.messageCount || 0) - messages.length)
    : 0
  const visibleMessages = hiddenCount > 0 ? messages.slice(-visibleCount) : messages
  useLayoutEffect(() => {
    const sessionId = activeSession?.id
    if (!mounted || !sessionId || bottomedSessionRef.current === sessionId) return
    if (!visibleMessages.length && Number(activeSession.messageCount || 0) > 0) return
    let settleFrame = 0
    const paintFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => {
        if (useChatStore.getState().settings.activeSessionId !== sessionId) return
        const el = scrollRef.current
        if (!el) return
        el.scrollTop = el.scrollHeight
        stickBottomRef.current = true
        bottomedSessionRef.current = sessionId
      })
    })
    return () => {
      cancelAnimationFrame(paintFrame)
      cancelAnimationFrame(settleFrame)
    }
  }, [activeSession?.id, activeSession?.messageCount, mounted, visibleMessages.length, visibleMessages.at(-1)?.id])
  useLayoutEffect(() => {
    const footer = footerRef.current
    if (!footer) return
    const updateInset = () => {
      const nextInset = Math.ceil(footer.getBoundingClientRect().height + 12)
      setFooterInset(current => current === nextInset ? current : nextInset)
    }
    updateInset()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateInset)
    observer.observe(footer)
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stickBottomRef.current) el.scrollTop = el.scrollHeight
  }, [footerInset])
  const nosePokeLine = (poke: { id: string; timestamp: number; sessionId: string }) => (
    <motion.p
      key={poke.id}
      initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }}
      className="chat-theme-muted my-3 text-center text-[11px] tracking-[0.08em]"
    >
      {fmtShortDate(poke.timestamp)} 你戳了一下豹子的鼻子
    </motion.p>
  )

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
  }, [messages, nosePokes, isLoading, streamText])

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
      setPendingImages((prev) => [...prev, dataUrl])
      setUploadingImg(false)
    }
    reader.onerror = () => setUploadingImg(false)
    reader.readAsDataURL(file)
  }

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    const available = MAX_CHAT_ATTACHMENTS - pendingAttachments.length
    if (available <= 0) return window.alert(`一条消息最多带 ${MAX_CHAT_ATTACHMENTS} 个文件。`)
    const selected = files.slice(0, available)
    const unsupported = selected.find(file => !isSupportedChatFile(file.name, file.type))
    if (unsupported) return window.alert('目前支持 TXT、Markdown、CSV、JSON、YAML、XML、RTF 和常见代码文件；PDF、Word 等二进制文件暂不支持。')
    const oversized = selected.find(file => file.size > MAX_CHAT_ATTACHMENT_BYTES)
    if (oversized) return window.alert(`单个文件不能超过 ${Math.round(MAX_CHAT_ATTACHMENT_BYTES / 1024)} KB。`)
    try {
      const attachments = await Promise.all(selected.map(async file => ({
        name: file.name.replace(/[\r\n]/g, ' ').trim().slice(0, 180),
        type: file.type || 'text/plain',
        size: file.size,
        text: await file.text(),
      })))
      setPendingAttachments(previous => [...previous, ...attachments])
    } catch {
      window.alert('文件读取失败，请重新选择。')
    }
  }

  const handlePhotoPromptChoice = async (choice: 'public' | 'locked' | 'no') => {
    if (!photoPrompt) return
    const { images } = photoPrompt
    setPhotoPrompt(null)
    if (choice !== 'no') {
      await Promise.all(images.map(dataUrl => photosApi.write('fire', dataUrl, '', 'chat', choice === 'locked').catch(() => null)))
    }
  }

  const savePencilDrawing = async (drawing: PencilDrawingResult) => {
    try {
      await pencilDrawingsApi.save(drawing.id)
      setSavedDrawings(current => new Set(current).add(drawing.id))
    } catch (error: any) {
      window.alert(error?.message || '这张画暂时没有存进照片墙。')
    }
  }

  const requestPencilRedraw = (drawing: PencilDrawingResult) => {
    setInput(`把刚才${drawing.title ? `那张《${drawing.title}》` : '那张画'}再画一版，保留主题，但换一个构图和笔触。`)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const savePencilDrawingLocally = async (drawing: PencilDrawingResult) => {
    try {
      const response = await fetch(drawing.imageUrl, { cache: 'no-store' })
      if (!response.ok) throw new Error('download failed')
      const blob = await response.blob()
      const baseName = (drawing.title || '星星的画').replace(/[\\/:*?"<>|]/g, '-').slice(0, 60)
      const file = new File([blob], `${baseName}.png`, { type: 'image/png' })
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: drawing.title || '星星的画' })
        return
      }
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error: any) {
      if (error?.name !== 'AbortError') window.alert('这张画暂时没有保存成功。')
    }
  }

  /* ── send ────────────────────────────── */

  const doSend = async (
    sendMessages: { id: string; role: string; route?: 'api' | 'claude-code'; ccAttemptId?: string; content: string; images?: string[]; timestamp?: number }[],
    onResult: (data: any) => void | Promise<void>,
    requestedRoute = activeRoute,
    turnId = sendMessages.at(-1)?.id || '',
    sessionAction?: 'rebase',
  ) => {
    const route = normalizeChatRoute(requestedRoute)
    const ccContextBeforeTokens = route === 'claude-code' && ccStatus.context.available
      ? ccStatus.context.usedTokens
      : undefined
    const onDone = (data: any) => {
      if (data.ccCompacted && activeSession?.id) {
        setContextWarning(null)
        setCcContextState(activeSession.id, current => ({
          ...current,
          warningLevel: undefined,
          lastCompaction: {
            at: Date.now(),
            source: 'automatic',
            beforeTokens: ccContextBeforeTokens,
            afterTokens: data.ccContextAfterTokens,
          },
        }))
      }
      return onResult({
        ...data,
        replyMode: 'long',
        content_blocks: data.content_blocks?.map((block: ContentBlock) => ({ ...block })),
        bubbleLayout: undefined,
      })
    }
    const profile = activeApiProfile
    const model = activeApiModel

    // Build bookmark injections
    const triggered = getTriggeredBookmarks(settings.bookmarks, messages)
    const persistentBookmarks = triggered.filter(bookmark => bookmark.alwaysOn)
    const transientBookmarks = triggered.filter(bookmark => !bookmark.alwaysOn)
    const bookmarkBlock = (items: typeof triggered) => items.length
      ? `[书签提醒]\n${items.map(bookmark => bookmark.content).join('\n---\n')}`
      : ''
    const windowPrompt = activeSession?.windowConfig?.systemPrompt
    const basePrompt = windowPrompt || settings.systemPrompt
    const systemPrompt = (route === 'claude-code'
      ? ccSystemPromptForModel(basePrompt, windowPrompt || settings.ccOpus55SystemPrompt, effectiveCcModel)
      : basePrompt) || undefined
    const readingInjection = contextInjection.trim()
    const statusInjection = timelineCurrent ? `[小火当前状态]\n正在做：${timelineCurrent.title}\n已持续：${Math.max(1, Math.floor((Date.now() - new Date(timelineCurrent.start_at).getTime()) / 60000))}分钟${timelineCurrent.tags?.length ? `\n标签：${timelineCurrent.tags.join('、')}` : ''}${timelineCurrent.note ? `\n开始备注：${timelineCurrent.note}` : ''}` : ''
    const summaryConfig = activeSession?.summaryConfig || { injectCount: settings.summaryInjectCount }
    const recentSummaries = [...(activeSession?.summaries || [])].sort((a, b) => b.endAt - a.endAt).slice(0, summaryConfig.injectCount).reverse()
    const recentStages = [...(activeSession?.stageSummaries || [])].sort((a, b) => b.endAt - a.endAt).slice(0, 2).reverse()
    const summaryInjection = recentSummaries.length || recentStages.length ? `[长期对话摘要｜马德里时间]\n${recentStages.map((item, i) => `阶段摘要${i + 1}（${fmtFullTs(item.startAt)} - ${fmtFullTs(item.endAt)}）\n${item.title}\n${item.content}`).join('\n\n---\n\n')}${recentStages.length && recentSummaries.length ? '\n\n=== 最近细节 ===\n\n' : ''}${recentSummaries.map((item, i) => `记忆${i + 1}（${fmtFullTs(item.startAt)} - ${fmtFullTs(item.endAt)}）\n${item.eventSummary}`).join('\n\n---\n\n')}` : ''
    const memoryInjection = [
      bookmarkBlock(persistentBookmarks.filter(bookmark => bookmark.position === 'start')),
      summaryInjection,
      bookmarkBlock(persistentBookmarks.filter(bookmark => bookmark.position === 'end')),
    ].filter(Boolean).join('\n\n')
    const clientVolatileContext = [
      bookmarkBlock(transientBookmarks.filter(bookmark => bookmark.position === 'start')),
      readingInjection,
      statusInjection,
      bookmarkBlock(transientBookmarks.filter(bookmark => bookmark.position === 'end')),
    ].filter(Boolean).join('\n\n')

    // Always stream the transport. A non-streaming /api/chat returns zero bytes
    // until the whole tool loop finishes (30-90s), which iOS Safari / mobile
    // networks silently drop as an idle connection -> fetch hangs, no reply, no
    // error (desktop tolerates it, mobile doesn't). Streaming keeps bytes
    // flowing so the connection stays alive on mobile. `live` only controls
    // whether the UI renders progressively; when off we just show loading dots.
    const live = route === 'claude-code' || settings.streamEnabled
    setStreamText('')
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
    let ccContextAfterTokens: number | undefined
    let paintTimer: ReturnType<typeof setTimeout> | null = null
    const paintStream = () => {
      paintTimer = null
      if (!live) return
      setStreamText(fullText)
      setStreamBlocks(contentBlocks.map(block => ({ ...block })))
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
        cc_model: route === 'claude-code' ? selectedCcModel : undefined,
        cc_effort: route === 'claude-code' ? normalizeCcEffortForModel(effectiveCcModel, activeCcEffort) : undefined,
        turn_id: route === 'claude-code' ? turnId : undefined,
        cc_session_action: route === 'claude-code' ? sessionAction : undefined,
        messages: sendMessages,
        system: systemPrompt,
        model,
        thinking_budget: settings.thinkingBudget,
        prompt_caching: settings.promptCaching,
        temperature: settings.temperature,
        stream: true,
        session_id: activeSession?.id,
        bookmark_injections: memoryInjection,
        client_volatile_context: clientVolatileContext,
        request_audit_hints: {
          summary: measureReceiptText(memoryInjection),
        },
        api_profile: route === 'api' && profile ? {
          profileId: profile.id, modelId: model,
        } : undefined,
      }, controller.signal)
      if (!res.ok) {
        const errText = await res.text()
        if (route === 'claude-code' && [502, 503, 504].includes(res.status)) {
          throw new Error(`CC 网关暂时中断 (${res.status})`)
        }
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
        } else if (evt.type === 'tool_start') {
          if (evt.name === 'view_foto' && typeof (evt.input as any)?.message_id === 'string') continue
          appendContentBlock({
            type: 'tool_call',
            callId: String(evt.call_id || ''),
            name: String(evt.name || ''),
            input: evt.input && typeof evt.input === 'object' ? evt.input : {},
            pending: true,
          })
        } else if (evt.type === 'tool_call') {
          const resolved = await resolveConfirmation(evt)
          if (resolved.name === 'view_foto' && typeof resolved.input?.message_id === 'string') continue
          toolCalls.push(resolved)
          const callId = String(resolved.call_id || '')
          const pendingIndex = callId
            ? contentBlocks.findIndex(block => block.type === 'tool_call' && block.pending && block.callId === callId)
            : -1
          const completed: ContentBlock = {
            type: 'tool_call', callId, name: resolved.name, input: resolved.input,
            result: resolved.result, pending: false,
          }
          if (pendingIndex >= 0) {
            contentBlocks[pendingIndex] = completed
            scheduleStreamPaint()
          } else appendContentBlock(completed)
        } else if (evt.type === 'error') {
          contentBlocks = contentBlocks.map(block => block.pending
            ? { ...block, pending: false, result: '工具调用中断' }
            : block)
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
          ccContextAfterTokens = Number.isFinite(evt.context?.usedTokens) ? Number(evt.context?.usedTokens) : ccContextAfterTokens
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
        ccContextAfterTokens,
        ccModelId: typeof usage.model === 'string' ? usage.model : undefined,
      })
      if (route === 'claude-code') void refreshCcStatus()
    } catch (err: any) {
      if (err?.name === 'AbortError' && explicitStopRef.current) {
          await onDone({
            content: fullText || '已停止生成。',
            thinking: fullThinking || undefined,
            tool_calls: toolCalls.length ? toolCalls : undefined,
            content_blocks: contentBlocks.length ? contentBlocks : undefined,
            ccAttemptId,
            stopped: true,
          })
      } else if (isRecoverableChatDisconnect(route, explicitStopRef.current, err?.name)) {
        // iOS reports a dropped CC stream as TypeError/"Load failed". The
        // gateway attempt is durable, so keep this turn pending for replay.
        setIsLoading(false)
        setStreamText('')
        setStreamBlocks([])
        recoveredTurnsRef.current.delete(`${activeSession?.id}:${turnId}`)
        setTimeout(() => setCcRecoveryTick(current => current + 1), 2_000)
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

  const regenerateStageSummary = useCallback(async (stage: StageSummary) => {
    const state = useChatStore.getState()
    const session = state.settings.sessions.find(item => item.id === stage.sessionId)
    if (!session || stage.locked || stageSummaryGenerating) return false
    const ids = new Set(stage.sourceSummaryIds)
    const batch = (session.summaries || []).filter(item => ids.has(item.id)).sort((a, b) => a.startAt - b.startAt)
    if (!batch.length) return false
    setSummaryError(''); setStageSummaryGenerating(true)
    try {
      const config = session.summaryConfig || { autoEnabled: true, turnSize: state.settings.summaryTurnSize, injectCount: state.settings.summaryInjectCount, modeVersion: 2 as const }
      const profile = state.settings.apiProfiles.find(item => item.id === config.profileId) || getActiveProfile(state.settings)
      const model = config.modelId || (profile?.id === state.settings.activeProfileId ? state.settings.model : profile?.defaultModel) || profile?.models[0]?.id || state.settings.model
      const data = await chatApi.summarize({ kind: 'stage', summaries: batch.map(item => ({ content: item.eventSummary })), model, api_profile: profile ? { profileId: profile.id, modelId: model } : undefined })
      if (!data.content) throw new Error('阶段摘要重新生成失败')
      updateStageSummary(session.id, stage.id, { title: String(data.title || stage.title).trim(), content: String(data.content).trim(), needsCorrection: false, editedAt: Date.now() })
      void syncChatNow()
      return true
    } catch (err: any) {
      setSummaryError(err?.message || '阶段摘要重新生成失败。')
      return false
    } finally { setStageSummaryGenerating(false) }
  }, [setStageSummaryGenerating, setSummaryError, stageSummaryGenerating, updateStageSummary])

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
        ccModel: session.ccModel,
        ccModelUpdatedAt: session.ccModelUpdatedAt,
        conversationMode: session.conversationMode,
        conversationModeUpdatedAt: session.conversationModeUpdatedAt,
        windowConfig: session.windowConfig,
        windowConfigUpdatedAt: session.windowConfigUpdatedAt,
        ccContextState: session.ccContextState,
        ccContextStateUpdatedAt: session.ccContextStateUpdatedAt,
      })
    }
    void flushChatOutbox().catch(() => {})
  }, [])

  const sendMessage = async () => {
    if ((!input.trim() && pendingImages.length === 0 && pendingAttachments.length === 0 && !pendingShare) || isLoading) return
    if (activeRoute === 'claude-code') void ensureCcAvailable(activeRoute, false)
    const profile = activeApiProfile
    const model = activeApiModel
    const now = Date.now()
    const userMsg: ChatMessage = {
      id: now.toString(),
      role: 'user',
      route: activeRoute,
      replyMode: 'long',
      content: input.trim(),
      timestamp: now,
      images: pendingImages.length ? pendingImages : undefined,
      attachments: pendingAttachments.length ? pendingAttachments : undefined,
      sharedCard: pendingShare || undefined,
      ccGenerationState: activeRoute === 'claude-code' ? 'pending' : undefined,
      providerId: activeRoute === 'claude-code' ? 'claude-code' : profile?.id,
      modelId: activeRoute === 'claude-code' ? effectiveCcModel : model,
    }
    stickBottomRef.current = true
    await durableAppend(activeSession, userMsg)
    if (activeRoute === 'claude-code' && (userMsg.images?.length || userMsg.attachments?.length)) await flushChatOutbox()
    addMessage(userMsg, activeSession?.id)
    if (userMsg.images?.length) setPhotoPrompt({ messageId: userMsg.id, images: [...userMsg.images] })
    onTurn?.('user', userMsg.content)
    setInput('')
    setPendingImages([])
    setPendingAttachments([])
    setPendingShare(null)
    setIsLoading(true)

    // Paint and persist the message first; refresh stale GPS before the model
    // request so every reply and wake sees the same server-side snapshot.
    await refreshLocation(false, 10 * 60 * 1000)

    const history = [...messages, userMsg]
    const slice = stableSlice(history, settings.contextLength)
    const apiMessages = slice.map(toModelMessage)

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
        modelId: activeRoute === 'claude-code' ? (data.ccModelId || effectiveCcModel) : model,
      }
      await durableAppend(activeSession, assistantMsg)
      addMessage(assistantMsg, activeSession?.id)
      if (activeRoute === 'claude-code') updateMessage(userMsg.id, { ccGenerationState: 'settled' })
      void syncChatNow()
      onTurn?.('assistant', assistantContent)
      setIsLoading(false)
      setStreamText('')
      setStreamBlocks([])
    }, activeRoute, userMsg.id)
  }

  const handleSend = async () => {
    if (sendLockRef.current) return
    sendLockRef.current = true
    setSendStarting(true)
    try { await sendMessage() }
    finally {
      sendLockRef.current = false
      setSendStarting(false)
    }
  }


  /* ── retry ────────────────────────────── */

  const retryMessage = async (msg: ChatMessage, skipConfirm = false, recoverPending = false) => {
    if (isLoading) return
    const retryRoute = normalizeChatRoute(msg.route)
    if (!skipConfirm) {
      const ok = await ask(msg.role === 'assistant' ? '重新生成这条回复？' : '重新发送并生成回复？')
      if (!ok) return
    }
    if (!await ensureCcAvailable(retryRoute, !recoverPending)) {
      if (recoverPending && activeSession?.id) recoveredTurnsRef.current.delete(`${activeSession.id}:${msg.id}`)
      return
    }

    const profile = activeApiProfile
    const model = activeApiModel
    setIsLoading(true)
    const currentMessages = useChatStore.getState().messages

    if (msg.role === 'assistant') {
      // Re-generate: use messages up to (but not including) this assistant message
      const idx = currentMessages.findIndex(m => m.id === msg.id)
      if (idx < 0) { setIsLoading(false); return }
      const slice = stableSlice(currentMessages.slice(0, idx), settings.contextLength)
      const apiMessages = slice.map(toModelMessage)
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
          modelId: retryRoute === 'claude-code' ? (data.ccModelId || effectiveCcModel) : model,
        }
        addMessageVersion(msg.id, newVersion, activeSession?.id)
        void syncChatNow()
        setIsLoading(false)
        setStreamText('')
        setStreamBlocks([])
      }, retryRoute, retryTurnId, retryRoute === 'claude-code' ? 'rebase' : undefined)
    } else {
      // User retry: regenerate the AI response that follows
      const idx = currentMessages.findIndex(m => m.id === msg.id)
      if (idx < 0) { setIsLoading(false); return }
      const nextMsg = currentMessages[idx + 1]
      const slice = stableSlice(currentMessages.slice(0, idx + 1), settings.contextLength)
      const apiMessages = slice.map(toModelMessage)
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
          modelId: retryRoute === 'claude-code' ? (data.ccModelId || effectiveCcModel) : model,
        }
        if (nextMsg?.role === 'assistant') {
          addMessageVersion(nextMsg.id, reply, activeSession?.id)
          void syncChatNow()
        } else {
          const assistantMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'assistant', ...reply }
          await durableAppend(activeSession, assistantMsg)
          addMessage(assistantMsg, activeSession?.id)
        }
        if (retryRoute === 'claude-code') updateMessage(msg.id, { ccGenerationState: 'settled' })
        void syncChatNow()
        setIsLoading(false)
        setStreamText('')
        setStreamBlocks([])
      }, retryRoute, retryTurnId, retryRoute === 'claude-code' && !recoverPending ? 'rebase' : undefined)
    }
  }

  const handleRetry = async (msg: ChatMessage, skipConfirm = false, recoverPending = false) => {
    if (isLoading || sendLockRef.current) return
    sendLockRef.current = true
    setSendStarting(true)
    try { await retryMessage(msg, skipConfirm, recoverPending) }
    finally {
      sendLockRef.current = false
      setSendStarting(false)
    }
  }

  // If a tab refreshed or iOS suspended the PWA after the user message was
  // saved, re-submit the same turn id. The gateway's idempotency ledger either
  // reconnects to the running attempt or replays its one completed result.
  useEffect(() => {
    if (!mounted || isLoading || sendStarting || !ccStatus.available || !activeSession?.id) return
    const pending = [...messages].reverse().find(message => message.role === 'user' && message.route === 'claude-code' && message.ccGenerationState === 'pending')
    if (!pending || messages.at(-1)?.id !== pending.id) return
    const key = `${activeSession.id}:${pending.id}`
    if (recoveredTurnsRef.current.has(key)) return
    recoveredTurnsRef.current.add(key)
    void handleRetry(pending, true, true)
    // Recovery is keyed to the durable turn, not ordinary streaming renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, activeSession?.id, ccStatus.available, ccRecoveryTick, isLoading, sendStarting, messages.at(-1)?.id, messages.at(-1)?.ccGenerationState])

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

  const toggleChatFavorite = async (msg: ChatMessage) => {
    if (!activeSession || !msg.content.trim()) return
    const targetKey = `${activeSession.id}:${msg.id}`
    const result = await apiRequest('/api/favorites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'toggle', actor: currentUser,
        favorite: {
          kind: 'chat', targetKey,
          title: `星星的回复 · ${fmtFullTs(msg.timestamp)}`,
          content: msg.content,
          metadata: { sessionId: activeSession.id, messageId: msg.id, sessionTitle: activeSession.title, timestamp: msg.timestamp },
        },
      }),
    })
    setFavoriteChatKeys(current => { const next = new Set(current); result.favorited ? next.add(targetKey) : next.delete(targetKey); return next })
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

  const startRename = (id: string, title: string) => { setEditingSessionId(id); setEditingTitle(title) }
  const finishRename = () => { if (editingSessionId) renameSession(editingSessionId, editingTitle); setEditingSessionId(null); setEditingTitle('') }
  const openChatSettings = (panel: ChatSettingsPanel) => { setChatSettingsPanel(panel); setSettingsOpen(true); setSessionDrawerOpen(false) }

  /* ── sidebar ──────────────────────────── */

  const SidebarContent = ({ mobile = false }: { mobile?: boolean }) => (
    <div className="chat-theme chat-theme-ui chat-theme-sidebar chat-theme-border relative flex h-full w-[86vw] max-w-[340px] flex-col overflow-hidden border-r">
      <div className={`chat-theme-border relative z-10 space-y-2.5 border-b px-4 pb-3 ${mobile ? 'pt-[max(3.5rem,calc(env(safe-area-inset-top)+1rem))]' : 'pt-14'}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-base font-medium">会话</div>
            <div className="text-xs opacity-40">{settings.sessions.length} 条对话</div>
          </div>
          <motion.button
            type="button"
            aria-label={n ? '切换到日间模式' : '切换到夜间模式'}
            title={n ? '切换到日间模式' : '切换到夜间模式'}
            onClick={toggleTheme}
            whileTap={{ scale: .82, rotate: n ? 18 : -18 }}
            className="chat-theme-icon chat-theme-accent grid h-9 w-9 place-items-center rounded-full"
          >
            {n ? <Sun size={17} strokeWidth={1.45}/> : <Moon size={17} strokeWidth={1.45}/>}
          </motion.button>
        </div>
        <section className="chat-theme-panel chat-theme-border rounded-xl border px-2.5 py-2">
          <div className="flex items-center gap-2">
            <span className="w-5 shrink-0 text-center text-base leading-none">{weather?.updatedAt ? weatherEmoji(weather.code) : '📍'}</span>
            {weather?.updatedAt ? (
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5 leading-none">
                  <span className="shrink-0 text-base tabular-nums">{weather.temp == null ? '—' : `${Math.round(weather.temp)}°`}</span>
                  <span className="min-w-0 truncate text-[11px] opacity-65">{weather.address || weather.city || '地址解析中'}</span>
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[8px] opacity-40">
                  <span className="min-w-0 truncate font-mono">{weather.lat.toFixed(2)}, {weather.lon.toFixed(2)}{weather.accuracy != null ? ` · ±${Math.round(weather.accuracy)}m` : ''}</span>
                  <span className="shrink-0">{new Date(weather.updatedAt).toLocaleTimeString('zh-CN', { timeZone: APP_TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                </div>
              </div>
            ) : (
              <div className="min-w-0 flex-1 text-[11px] opacity-50">尚未定位</div>
            )}
            <button type="button" aria-label="刷新天气和位置" aria-busy={locationRefreshing} disabled={locationRefreshing} onClick={() => void refreshLocation(true)} className="chat-theme-icon grid h-7 w-7 shrink-0 place-items-center rounded-full disabled:opacity-70">
              <RotateCcw size={12} className={locationRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          {locationError && <div className="mt-1 pl-7 text-[8px] text-red-500/75">{locationError}</div>}
        </section>
      </div>
      <div className="relative z-10 flex-1 overflow-y-auto px-2 pb-2 pt-4 space-y-1">
        {sessions.map((s) => {
          const active = s.id === settings.activeSessionId
          return (
            <div key={s.id} onClick={() => { setActiveSession(s.id); setSessionActionsId(null); if (mobile) setSessionDrawerOpen(false) }}
              className={`group cursor-pointer rounded-xl p-3 transition ${active ? 'chat-theme-soft' : 'chat-theme-hover'}`}>
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  {editingSessionId === s.id ? (
                    <input value={editingTitle} autoFocus onChange={(e) => setEditingTitle(e.target.value)}
                      onBlur={finishRename} onKeyDown={(e) => { if (e.key === 'Enter' && !(e.nativeEvent as any).isComposing) finishRename(); if (e.key === 'Escape') setEditingSessionId(null) }}
                      onClick={(e) => e.stopPropagation()} className="chat-theme-surface w-full rounded px-2 py-1 text-xs outline-none" />
                  ) : (
                    <div className="text-sm font-medium truncate flex items-center gap-1">
                      {s.pinned && <Pin size={11} className="chat-theme-accent" />}
                      {s.title}
                    </div>
                  )}
                  <div className="text-xs opacity-40 mt-1 flex justify-between">
                    <span>{s.messageCount || s.messages.length} 条消息</span>
                    <span>{fmtShortDate(s.updatedAt)}</span>
                  </div>
                </div>
                <div className="relative" onClick={(e) => e.stopPropagation()}>
                  <button aria-label="会话操作" onClick={() => setSessionActionsId(current => current === s.id ? null : s.id)} className="chat-theme-icon rounded-full p-1.5 opacity-45 hover:opacity-100"><MoreHorizontal size={14}/></button>
                  {sessionActionsId === s.id && <div className="chat-theme-surface chat-theme-border absolute right-0 top-full z-20 mt-1 min-w-28 rounded-xl border py-1 shadow-lg">
                    <button onClick={() => { togglePinSession(s.id); setSessionActionsId(null) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"><Pin size={12}/>{s.pinned ? '取消置顶' : '置顶'}</button>
                    <button onClick={() => { startRename(s.id, s.title); setSessionActionsId(null) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"><Pencil size={12}/>重命名</button>
                    <button onClick={async () => { const ok = await ask('删除这条对话？'); if (ok) deleteSession(s.id); setSessionActionsId(null) }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-500"><Trash2 size={12}/>删除</button>
                  </div>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <div className="relative z-10 shrink-0 px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="chat-theme-panel chat-theme-border overflow-hidden rounded-2xl border">
        <section className="p-3">
          <div className="flex items-center justify-between text-[10px] tracking-[0.16em] opacity-55">
            <span>CLAUDE 额度 · 订阅</span>
            <button type="button" aria-label="刷新 CC 状态" aria-busy={ccRefreshing} disabled={ccRefreshing} onClick={() => void refreshCcStatus()} className="chat-theme-icon -m-1 rounded-full p-1 hover:opacity-100 disabled:opacity-70">
              <RotateCcw size={13} className={ccRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          {ccStatus.quota.available && ccStatus.quota.fiveHour ? (
            <>
              <div className="mt-1.5 flex items-end justify-between gap-2">
                <div className="text-xl leading-none tabular-nums">余 {Math.max(0, Math.round(100 - ccStatus.quota.fiveHour.usedPercentage))}%</div>
                <span className={`text-[10px] ${ccStatus.quota.stale ? 'opacity-45' : 'chat-theme-accent'}`}>
                  {ccStatus.quota.stale ? '● 上次读数' : '● 已读取'}
                </span>
              </div>
              <div className="mt-2 flex justify-between text-[10px] opacity-50">
                <span>5 小时已用 {Math.round(ccStatus.quota.fiveHour.usedPercentage)}%{ccStatus.quota.fiveHour.requestCount != null ? ` · ${ccStatus.quota.fiveHour.requestCount} 次` : ''}</span>
                <span>重置 {fmtMetricReset(ccStatus.quota.fiveHour.resetsAt)}</span>
              </div>
              <div className="chat-theme-soft mt-1.5 h-1 overflow-hidden rounded-full">
                <div className="chat-theme-accent-bg h-full rounded-full" style={{ width: `${ccStatus.quota.fiveHour.usedPercentage}%` }} />
              </div>
              <div className="mt-2 flex justify-between gap-2 text-[10px] opacity-45">
                <span>{ccStatus.quota.sevenDay ? `7 天剩余 ${Math.max(0, Math.round(100 - ccStatus.quota.sevenDay.usedPercentage))}%${ccStatus.quota.sevenDay.requestCount != null ? ` · ${ccStatus.quota.sevenDay.requestCount} 次` : ''}` : '7 天额度暂缺'}</span>
                <span>{ccStatus.quota.sevenDay ? `重置 ${fmtMetricReset(ccStatus.quota.sevenDay.resetsAt)}` : fmtMetricTime(ccStatus.quota.collectedAt)}</span>
              </div>
            </>
          ) : (
            <>
              <div className="mt-1.5 flex items-end justify-between gap-2">
                <div className="text-xl leading-none">暂不可读</div>
                <span className={`text-[10px] ${ccStatus.available ? 'chat-theme-accent' : 'text-red-500'}`}>
                  {ccStatus.available ? '● 线路在线' : '● 线路离线'}
                </span>
              </div>
              <div className="mt-2 text-[10px] leading-relaxed opacity-45">额度读取失败时不影响 CC 聊天；稍后点刷新重试。</div>
            </>
          )}
        </section>

        <section className="chat-theme-border border-t p-3">
          <div className="flex items-center justify-between text-[10px] tracking-[0.16em] opacity-55">
            <span>CC CONTEXT · 当前对话</span>
            <span className={ccStatus.context.available ? 'chat-theme-accent' : ''}>●</span>
          </div>
          {ccStatus.context.available ? (
            <>
              <div className="mt-1.5 text-xl leading-none tabular-nums">{fmtTokens(ccStatus.context.usedTokens)} / {fmtTokens(ccStatus.context.maxTokens)}</div>
              <div className="mt-2 flex justify-between text-[10px] opacity-50">
                <span>上下文水位 · {ccStatus.context.usedPercentage ?? '—'}%</span>
                <span>{fmtMetricTime(ccStatus.context.collectedAt)}</span>
              </div>
              <div className="chat-theme-soft mt-1.5 h-1 overflow-hidden rounded-full">
                <div className={`h-full rounded-full ${currentContextLevel === 95 ? 'bg-red-500' : currentContextLevel >= 85 ? 'bg-amber-500' : 'chat-theme-accent-bg'}`} style={{ width: `${Math.min(100, ccStatus.context.usedPercentage || 0)}%` }} />
              </div>
              {currentContextLevel >= 70 && <div className={`mt-2 text-[10px] ${currentContextLevel === 95 ? 'text-red-500' : currentContextLevel >= 85 ? 'text-amber-600' : 'opacity-45'}`}>{currentContextLevel === 95 ? '接近上限 · 建议现在压缩' : currentContextLevel === 85 ? '建议近期压缩' : '已进入上下文后半程'}</div>}
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
        <div className="chat-theme-border border-t">
          <div className="grid grid-cols-4">
            <button type="button" onClick={() => { setSessionDrawerOpen(false); setWindowSettingsOpen(true) }} className="chat-theme-hover chat-theme-border border-r py-2 text-[10px]">本窗</button>
            <button type="button" onClick={() => { setSessionDrawerOpen(false); setModelDialogOpen(true) }} className="chat-theme-hover chat-theme-border border-r py-2 text-[10px]">模型库</button>
            <button type="button" onClick={() => openChatSettings('settings')} className="chat-theme-hover chat-theme-border border-r py-2 text-[10px]">参数</button>
            <button type="button" onClick={() => { continueSession(50); if (mobile) setSessionDrawerOpen(false) }} className="chat-theme-hover py-2 text-[10px]">换窗</button>
          </div>
          <div className="chat-theme-border grid grid-cols-4 border-t">
            <button type="button" onClick={() => { setSessionDrawerOpen(false); setSummaryDialogOpen(true) }} className="chat-theme-hover chat-theme-border border-r py-2 text-[10px]">摘要</button>
            <button type="button" onClick={() => { setSessionDrawerOpen(false); setBookmarkDialogOpen(true) }} className="chat-theme-hover chat-theme-border border-r py-2 text-[10px]">书签</button>
            <button type="button" onClick={() => { setSessionDrawerOpen(false); setRoomPanel('wake') }} className="chat-theme-hover chat-theme-border border-r py-2 text-[10px]">唤醒</button>
            <button type="button" onClick={() => { setSessionDrawerOpen(false); setRoomPanel('memory') }} className="chat-theme-hover py-2 text-[10px]">记忆</button>
          </div>
        </div>
        </div>
      </div>
    </div>
  )

  /* ── render ───────────────────────────── */

  const visibleContextWarning = contextWarning?.sessionId === activeSession?.id ? contextWarning : null
  return (
    <>
      <div className="chat-theme relative flex h-full overflow-hidden">
        {!embedded && <div className="hidden lg:block h-full relative z-10">
          <SidebarContent />
        </div>}

        <div className="flex flex-col h-full flex-1 min-w-0 relative z-10">
          {!embedded && <div className="chat-theme-ui chat-theme-accent grid grid-cols-3 items-center px-4 pb-1 pt-[max(.65rem,env(safe-area-inset-top))]">
            <button onClick={() => setSessionDrawerOpen(true)} aria-label="打开会话" className="chat-theme-icon justify-self-start rounded-full p-2 lg:invisible">
              <Menu size={22} strokeWidth={1.45}/>
            </button>
            <motion.button
              type="button"
              aria-label="回到主页"
              onClick={() => setSidebarOpen(true)}
              whileTap={{ scale: 0.82, rotate: 12 }}
              className="chat-theme-icon justify-self-center rounded-full p-2 text-[25px] leading-none"
            >🐆</motion.button>
            <button aria-label="打开房间" onClick={() => openChatSettings('menu')} className="chat-theme-icon justify-self-end rounded-full p-2">
              <Moon size={21} strokeWidth={1.45}/>
            </button>
          </div>}

          <AnimatePresence>
            {visibleContextWarning && <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="mx-4 mb-1 flex items-center gap-2">
              <button type="button" onClick={() => { setContextWarning(null); setWindowSettingsOpen(true) }} className={`min-w-0 flex-1 rounded-xl border px-3 py-2 text-left text-[11px] ${visibleContextWarning.level === 95 ? 'border-red-500/35 bg-red-500/10 text-red-600' : n ? 'border-amber-400/25 bg-amber-400/10 text-amber-300' : 'border-amber-600/20 bg-amber-50 text-amber-700'}`}>
                上下文 {Math.round(ccStatus.context.usedPercentage || visibleContextWarning.level)}% · {visibleContextWarning.level === 95 ? '建议现在压缩' : '建议近期压缩'} <span className="ml-1 underline underline-offset-2">查看</span>
              </button>
              <button type="button" aria-label="关闭上下文预警" onClick={() => setContextWarning(null)} className="rounded-full p-1.5 opacity-45"><X size={14}/></button>
            </motion.div>}
          </AnimatePresence>

          {/* messages */}
          <div ref={scrollRef} onScroll={handleScroll} style={{ paddingBottom: footerInset }} className="flex-1 min-h-0 overflow-y-auto px-4 pt-5 md:px-6 space-y-4" onClick={() => { if (deleteMenuId) setDeleteMenuId(null); setMessageActionsId(null) }}>
            {messages.length === 0 && (
              <div className="chat-theme-ui chat-theme-muted flex h-full items-center justify-center text-center text-xs tracking-[0.12em] opacity-45">
                <span>在这里等你</span>
              </div>
            )}

            {(hiddenCount > 0 || serverHiddenCount > 0) && (
              <div className="flex justify-center pb-2">
                <button onClick={() => void handleLoadEarlier()} disabled={historyLoading}
                  className="chat-theme-soft rounded-full px-3 py-1.5 text-[11px] opacity-60 hover:opacity-100">
                  {historyLoading ? '加载中…' : `加载更早的 ${Math.min(CHAT_PAGE_SIZE, hiddenCount || serverHiddenCount)} 条（还有 ${hiddenCount + serverHiddenCount} 条）`}
                </button>
              </div>
            )}

            <div>
              {visibleMessages.map((msg, messageIndex) => {
                const isUser = msg.role === 'user'
                const previousTimestamp = messageIndex > 0 ? visibleMessages[messageIndex - 1].timestamp : -Infinity
                const precedingPokes = nosePokes.filter(poke => poke.timestamp > previousTimestamp && poke.timestamp <= msg.timestamp)
                const versions = msg.versions || []
                const vIdx = msg.versionIndex ?? 0
                const hasVersions = versions.length > 1
                const isEditing = editingMsgId === msg.id
                const { displayContentBlocks, firstTextBlockIndex, pencilDrawing, messageImages, thinkingParts } = prepareChatMessage(msg)
                return (
                  <Fragment key={msg.id}>
                  {precedingPokes.map(nosePokeLine)}
                  <div className="flex mb-4" onClick={(event) => { event.stopPropagation(); setMessageActionsId(current => current === msg.id ? null : msg.id) }}>
                    <div className="w-full space-y-1">
                      {/* wake indicator */}
                      {(msg as any)._wake && (
                        <div className="chat-theme-accent mb-0.5 flex items-center gap-1.5 px-1 text-[10px]">
                          <span>💓</span> <span>心跳唤醒</span>
                        </div>
                      )}

                      {/* timestamp */}
                      <p className={`chat-theme-ui chat-theme-muted text-[11px] ${isUser ? 'pr-1 text-right' : 'pl-4 text-left'}`}>
                        {fmtShortDate(msg.timestamp)}
                      </p>

                      {!isUser && thinkingParts.length > 0 && (
                        <button
                          type="button"
                          aria-label="打开星星的小算盘"
                          onClick={(event) => { event.stopPropagation(); setThinkingDrawer({ id: msg.id, parts: thinkingParts }) }}
                          className="chat-theme-icon chat-theme-muted ml-3 grid h-7 w-7 place-items-center rounded-full text-sm"
                        >
                          <span aria-hidden="true">💭</span>
                        </button>
                      )}

                      {/* Inline content blocks — interleaved thinking/tool/text */}
                      {!isUser && displayContentBlocks && displayContentBlocks.length > 0 ? (
                        <>
                          {displayContentBlocks.map((block: ContentBlock, bi: number) => {
                            const blockKey = `${msg.id}-b${bi}`
                            if (block.type === 'thinking') return null
                            if (block.type === 'tool_call' && block.name) {
                              const isExp = expandedTools.has(blockKey)
                              return (
                                <div key={blockKey} className="chat-theme-surface chat-theme-border mr-auto w-fit max-w-[90%] rounded-xl border">
                                  <button onClick={() => toggleTools(blockKey)} className="chat-theme-muted flex w-full items-center gap-2 px-3 py-2 text-xs">
                                    <span className="chat-theme-accent">🔧</span>
                                    <span className="chat-theme-accent font-medium">{toolDisplayLabel(block.name)}</span>
                                    <ChevronDown size={12} className={`ml-auto transition-transform flex-shrink-0 ${isExp ? '' : '-rotate-90'}`} />
                                  </button>
                                  <AnimatePresence>
                                    {isExp && (
                                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                        <div className={`px-3 pb-2 text-xs space-y-1.5`}>
                                          {block.input && Object.keys(block.input).length > 0 && (
                                            <pre className="chat-theme chat-theme-muted rounded p-1.5 text-[10px] leading-relaxed whitespace-pre-wrap break-all">
                                              {JSON.stringify(toolDisplayInput(block.name, block.input), null, 2)}
                                            </pre>
                                          )}
                                          {block.result && (
                                            <div className="chat-theme-border border-t pt-1">
                                              <span className="text-[10px] opacity-40 block mb-1">返回结果</span>
                                              <pre className="chat-theme chat-theme-muted max-h-[200px] overflow-y-auto rounded p-1.5 text-[10px] leading-relaxed whitespace-pre-wrap break-all">
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
                                <div key={blockKey} className="chat-ai-bubble relative mr-auto block w-fit max-w-[91%] break-words px-4 py-3 text-left text-[14px] leading-relaxed">
                                  {messageImages && bi === firstTextBlockIndex && messageImages.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                                      {messageImages.map((src: string, ii: number) => (
                                        <img key={ii} src={src} alt="" loading="lazy" decoding="async" className={pencilDrawing ? 'max-w-[260px] max-h-[360px] rounded-lg object-contain' : 'max-w-[180px] max-h-[180px] rounded-lg object-cover'} />
                                      ))}
                                    </div>
                                  )}
                                  {pencilDrawing && bi === firstTextBlockIndex && (
                                    <div className="mb-2 flex items-center gap-3 text-[11px]" onClick={event => event.stopPropagation()}>
                                      <button type="button" disabled={savedDrawings.has(pencilDrawing.id)} onClick={() => void savePencilDrawing(pencilDrawing)} className="opacity-65 hover:opacity-100 disabled:opacity-35">
                                        {savedDrawings.has(pencilDrawing.id) ? '已存进照片墙' : '存进照片墙'}
                                      </button>
                                      <button type="button" onClick={() => void savePencilDrawingLocally(pencilDrawing)} className="opacity-65 hover:opacity-100">保存到本地</button>
                                      <button type="button" onClick={() => requestPencilRedraw(pencilDrawing)} className="opacity-65 hover:opacity-100">再画一版</button>
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
                          {/* Legacy: tool calls above bubble */}
                          {msg.tool_calls && msg.tool_calls.length > 0 && (
                            <div className="w-fit max-w-[90%] mr-auto">
                              <button onClick={() => toggleTools(msg.id)} className="chat-theme-accent flex items-center gap-1 text-xs">
                                <ChevronDown size={12} className={`transition-transform ${expandedTools.has(msg.id) ? '' : '-rotate-90'}`} />
                                🔧 {msg.tool_calls.map((tc: any) => toolDisplayLabel(tc.name)).join('、')}
                              </button>
                              <AnimatePresence>
                                {expandedTools.has(msg.id) && (
                                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                                    <div className="chat-theme-surface space-y-1.5 rounded-xl p-2 text-xs">
                                      {msg.tool_calls.map((tc: any, i: number) => (
                                        <div key={i} className="chat-theme space-y-1.5 rounded-lg p-2">
                                          <div>
                                            <span className="chat-theme-accent font-medium">{toolDisplayLabel(tc.name)}</span>
                                          </div>
                                          {tc.input && Object.keys(tc.input).length > 0 && (
                                            <pre className="chat-theme-soft chat-theme-muted rounded p-1.5 text-[10px] leading-relaxed whitespace-pre-wrap break-all">
                                              {JSON.stringify(toolDisplayInput(tc.name, tc.input), null, 2)}
                                            </pre>
                                          )}
                                          {tc.result && (
                                            <div className="chat-theme-border mt-1 border-t pt-1.5">
                                              <span className="text-[10px] opacity-40 block mb-1">返回结果</span>
                                              <pre className="chat-theme-soft chat-theme-muted max-h-[300px] overflow-y-auto rounded p-1.5 text-[10px] leading-relaxed whitespace-pre-wrap break-all">
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
                            className="chat-theme-surface w-full resize-y p-3 text-sm outline-none" rows={3} autoFocus />
                          <div className="chat-theme-surface flex justify-end gap-2 px-3 py-2">
                            <button onClick={() => { setEditingMsgId(null); setEditingMsgText('') }} className="text-xs opacity-60">取消</button>
                            <button onClick={finishEditMsg} className="chat-theme-accent text-xs font-medium">保存</button>
                          </div>
                        </div>
                      ) : ((isUser || !displayContentBlocks || displayContentBlocks.length === 0) && (msg.content.trim() || (msg.images?.length || 0) > 0 || (msg.attachments?.length || 0) > 0 || !!msg.sharedCard)) ? (
                        <div className={`${isUser ? 'chat-theme-user' : 'chat-ai-bubble'} relative block break-words px-4 py-3 text-[14px] leading-relaxed ${isUser ? 'ml-auto w-fit max-w-[77%] rounded-2xl rounded-br-md' : 'mr-auto w-fit max-w-[91%] text-left'}`}>
                          {msg.sharedCard && (
                            <div className="chat-theme-surface chat-theme-border mb-2 overflow-hidden rounded-xl border">
                              <div className="px-3 py-2 text-xs font-medium">📎 {msg.sharedCard.title}</div>
                              {msg.sharedCard.imageUrl && <img src={msg.sharedCard.imageUrl} alt="" loading="lazy" decoding="async" className="w-full max-h-48 object-contain" />}
                              <div className="px-3 pb-2 text-[11px] whitespace-pre-wrap">{msg.sharedCard.subtitle}{msg.sharedCard.body ? `\n${msg.sharedCard.body}` : ''}</div>
                            </div>
                          )}
                          {messageImages && messageImages.length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-1.5">
                              {messageImages.map((src, i) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img key={i} src={src} alt="" loading="lazy" decoding="async" className={pencilDrawing ? 'max-w-[260px] max-h-[360px] rounded-lg object-contain' : 'max-w-[180px] max-h-[180px] rounded-lg object-cover'} />
                              ))}
                            </div>
                          )}
                          {pencilDrawing && (
                            <div className="mb-2 flex items-center gap-3 text-[11px]" onClick={event => event.stopPropagation()}>
                              <button type="button" disabled={savedDrawings.has(pencilDrawing.id)} onClick={() => void savePencilDrawing(pencilDrawing)} className="opacity-65 hover:opacity-100 disabled:opacity-35">
                                {savedDrawings.has(pencilDrawing.id) ? '已存进照片墙' : '存进照片墙'}
                              </button>
                              <button type="button" onClick={() => void savePencilDrawingLocally(pencilDrawing)} className="opacity-65 hover:opacity-100">保存到本地</button>
                              <button type="button" onClick={() => requestPencilRedraw(pencilDrawing)} className="opacity-65 hover:opacity-100">再画一版</button>
                            </div>
                          )}
                          {msg.attachments && msg.attachments.length > 0 && (
                            <div className="mb-1.5 flex flex-col gap-1.5">
                              {msg.attachments.map((file, index) => (
                                <div key={`${file.name}-${index}`} className="chat-theme-surface chat-theme-border flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs">
                                  <Paperclip size={14} className="shrink-0 opacity-60" />
                                  <span className="min-w-0 truncate">{file.name}</span>
                                  <span className="shrink-0 opacity-45">{Math.max(1, Math.ceil(file.size / 1024))} KB</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {msg.content.trim() && <MarkdownText content={msg.content} />}
                        </div>
                      ) : null}

                      {photoPrompt?.messageId === msg.id && (
                        <div className="chat-theme-surface chat-theme-border ml-auto w-fit max-w-[86%] rounded-xl border px-3 py-2 text-xs" onClick={event => event.stopPropagation()}>
                          <p>要收藏进照片墙吗？</p>
                          <div className="mt-2 flex items-center justify-end gap-3">
                            <button onClick={() => void handlePhotoPromptChoice('public')} className="chat-theme-accent">公开</button>
                            <button onClick={() => void handlePhotoPromptChoice('locked')} className="chat-theme-accent">上锁</button>
                            <button onClick={() => void handlePhotoPromptChoice('no')} className="opacity-50">不用</button>
                          </div>
                        </div>
                      )}

                      {/* AI route; session and cache details unfold with message actions. */}
                      {!isUser && messageActionsId === msg.id && (
                        <div onClick={event => event.stopPropagation()} className="chat-theme-muted flex flex-wrap items-center gap-x-2 pl-4 text-[10px]">
                          <span className="opacity-40">{chatRouteLabel(msg.route)}</span>
                          {msg.ccSessionFingerprint && <span className="opacity-35" title={`${msg.ccSessionMode || 'session'} · ${msg.ccSessionReason || 'normal'}${msg.ccCompacted ? ' · compacted' : ''}`}>会话 {msg.ccSessionFingerprint}{msg.ccCompacted ? ' · 已整理' : ''}</span>}
                          {(msg.input_tokens != null && msg.input_tokens > 0) && (() => {
                            const inp = msg.input_tokens || 0
                            const out = msg.output_tokens || 0
                            const cr = msg.cache_read_tokens || 0
                            const cw = msg.cache_creation_tokens || 0
                            const ratio = (inp + cr + cw) > 0 ? Math.round((cr / (inp + cr + cw)) * 100) : 0
                            return (
                              <button type="button" onClick={() => setReceiptMessage(msg)} className="opacity-60 hover:opacity-100 underline decoration-dotted underline-offset-2" title={`查看上下文小票：输入${inp} · 输出${out} · 缓存命中${ratio}%`}>
                                缓存 {ratio}%
                              </button>
                            )
                          })()}
                        </div>
                      )}

                      {/* action buttons */}
                      {messageActionsId === msg.id && <div onClick={event => event.stopPropagation()} className={`flex items-center gap-1 ${isUser ? 'justify-end' : 'justify-start pl-3'} opacity-55 transition-opacity relative`}>
                        <button onClick={() => handleRetry(msg, false, msg.ccGenerationState === 'pending')} title="重试" className="p-1"><RotateCcw size={12} /></button>
                        <button onClick={() => handleDeleteMsg(msg.id)} title="删除" className="p-1"><Trash2 size={12} /></button>
                        <button onClick={() => handleCopy(msg.id, msg.content)} title="复制" className="p-1">
                          {copiedId === msg.id ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                        {!isUser && !!msg.content.trim() && <button onClick={() => toggleChatFavorite(msg)} title={activeSession && favoriteChatKeys.has(`${activeSession.id}:${msg.id}`) ? '取消收藏' : '收藏'} className="p-1"><Heart size={12} fill={activeSession && favoriteChatKeys.has(`${activeSession.id}:${msg.id}`) ? 'currentColor' : 'none'} /></button>}
                        {isUser && <button onClick={() => startEditMsg(msg)} title="修改" className="p-1"><Pencil size={12} /></button>}
                        {deleteMenuId === msg.id && (
                          <div className={`chat-theme-surface chat-theme-border absolute ${isUser ? 'right-0' : 'left-0'} top-full z-20 mt-1 min-w-[160px] rounded-xl border py-1 shadow-lg`}>
                            <button onClick={() => doDeleteVersion(msg)} className="chat-theme-hover w-full px-3 py-2 text-left text-xs">删除此版本{(msg.versions?.length || 0) > 1 ? ` (${(msg.versionIndex ?? 0) + 1}/${msg.versions!.length})` : ''}</button>
                            <button onClick={() => doDeleteAllVersions(msg.id)} className="chat-theme-hover w-full px-3 py-2 text-left text-xs text-red-500">删除全部版本</button>
                          </div>
                        )}
                      </div>}

                      {/* version switcher */}
                      {hasVersions && (
                        <div className={`chat-theme-muted flex items-center gap-2 text-[10px] ${isUser ? 'justify-end' : 'justify-start'}`}>
                          <button disabled={vIdx <= 0} onClick={() => switchMessageVersion(msg.id, vIdx - 1)} className="p-0.5 disabled:opacity-20"><ChevronLeft size={11} /></button>
                          <span>{vIdx + 1}/{versions.length}</span>
                          <button disabled={vIdx >= versions.length - 1} onClick={() => switchMessageVersion(msg.id, vIdx + 1)} className="p-0.5 disabled:opacity-20"><ChevronRight size={11} /></button>
                        </div>
                      )}

                    </div>
                  </div>
                  </Fragment>
                )
              })}
              {nosePokes.filter(poke => poke.timestamp > (visibleMessages.at(-1)?.timestamp ?? -Infinity)).map(nosePokeLine)}
            </div>

            {/* loading / streaming */}
            {isLoading && (
              <StreamingReply
                blocks={streamBlocks}
                onOpenThinking={(parts) => setThinkingDrawer({ id: 'stream', parts })}
                expandedTools={expandedTools}
                onToggleTools={toggleTools}
              />
            )}

            <div ref={messagesEndRef} />
          </div>


          {/* footer */}
          <div ref={footerRef} className="chat-footer absolute inset-x-0 bottom-0 z-20 px-3 pt-1">
            {/* pending shared card */}
            {pendingShare && (
              <div className="chat-theme-surface chat-theme-border mx-1 mb-2 overflow-hidden rounded-xl border">
                <div className="flex items-center justify-between px-3 py-2 text-xs">
                  <span>📎 已带入 {pendingShare.title}</span>
                  <button onClick={() => setPendingShare(null)} className="opacity-50"><X size={14} /></button>
                </div>
                <div className="px-3 pb-2 text-[11px] space-y-1">
                  {pendingShare.imageUrl && <img src={pendingShare.imageUrl} alt="" className="w-full max-h-40 object-contain rounded-lg" />}
                  <div className="font-medium">{pendingShare.subtitle}</div>
                  <div className="whitespace-pre-wrap opacity-70">{pendingShare.body}</div>
                </div>
              </div>
            )}
            {/* pending image previews */}
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
            {pendingAttachments.length > 0 && (
              <div className="mb-2 flex flex-col gap-1.5 px-1">
                {pendingAttachments.map((file, index) => (
                  <div key={`${file.name}-${index}`} className="chat-theme-surface chat-theme-border flex items-center gap-2 rounded-xl border px-3 py-2 text-xs">
                    <Paperclip size={14} className="shrink-0 opacity-60" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="opacity-45">{Math.max(1, Math.ceil(file.size / 1024))} KB</span>
                    <button type="button" aria-label={`移除 ${file.name}`} onClick={() => setPendingAttachments(previous => previous.filter((_, itemIndex) => itemIndex !== index))} className="opacity-50"><X size={13} /></button>
                  </div>
                ))}
              </div>
            )}

            <div className="chat-theme-ui chat-compose-shell relative">
              <div className="chat-input-tray chat-theme-input rounded-[26px] border px-3 pb-2 pt-3 transition-all duration-200">
                <textarea aria-label="聊天输入" ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onFocus={() => setMessageActionsId(null)}
                  placeholder={inputPlaceholder} rows={1} enterKeyHint="enter"
                  className="no-frame chat-theme-text chat-theme-placeholder block min-h-10 max-h-40 w-full resize-none bg-transparent px-1 py-1 text-base outline-none md:text-sm" />
                <input ref={imgInputRef} type="file" accept="image/*" hidden onChange={handleUploadImage} />
                <input ref={fileInputRef} type="file" multiple accept="text/*,.md,.markdown,.csv,.json,.yaml,.yml,.xml,.rtf,.js,.jsx,.ts,.tsx,.py,.css,.scss,.sql,.sh,.log,.java,.c,.cc,.cpp,.h,.hpp,.go,.rs,.swift,.kt,.kts" hidden onChange={handleUploadFile} />
                <div className="chat-theme-accent mt-1 flex items-center gap-0.5">
                  <button type="button" aria-label={uploadingImg ? '正在处理照片' : '上传照片'} title="照片" disabled={uploadingImg} onClick={() => imgInputRef.current?.click()} className="chat-theme-icon grid h-8 w-8 place-items-center rounded-full disabled:opacity-35"><ImagePlus size={17}/></button>
                  <button type="button" aria-label="添加文件" title="文件" onClick={() => fileInputRef.current?.click()} className="chat-theme-icon grid h-8 w-8 place-items-center rounded-full"><Paperclip size={17}/></button>
                  <TimelineButton current={timelineCurrent} onClick={() => setTimelineOpen(true)} />
                  <motion.button type="button" aria-label="戳豹子鼻子" title="戳豹子鼻子" disabled={nosePokeBusy} onPointerDown={event => event.preventDefault()} onClick={() => void pokeLeopardNose()} whileTap={{ scale: .9 }} className="chat-theme-icon grid h-8 w-8 place-items-center rounded-full text-[18px] leading-none disabled:opacity-35">
                    <span aria-hidden="true">🐆</span>
                  </motion.button>
                  <button type="button" aria-label="打开今天怎么操" title="今天怎么操" onClick={() => setWheelOpen(true)} className="chat-theme-icon grid h-8 w-8 place-items-center rounded-full"><Dices size={17}/></button>
                  <ChatRouteChip route={activeRoute} detail={activeRoute === 'claude-code' ? (CC_MODELS.find(model => model.id === effectiveCcModel)?.name || effectiveCcModel) : activeApiModel} isNight={n} onClick={() => setModelPickerOpen(true)} />
                  <span className="flex-1" />
                  {isLoading ? (
                    <button onClick={() => { void handleStopGeneration() }} title="停止生成" className="chat-theme-accent-bg grid h-8 w-8 place-items-center rounded-full text-[#3f2c29]">
                      <Square size={14} fill="currentColor" />
                    </button>
                  ) : (
                    <button aria-label={sendStarting ? '正在发送消息' : '发送消息'} aria-busy={sendStarting} onClick={handleSend} disabled={sendStarting || (!input.trim() && pendingImages.length === 0 && pendingAttachments.length === 0 && !pendingShare)}
                      className={`grid h-8 w-8 place-items-center rounded-full transition-all ${!sendStarting && (input.trim() || pendingImages.length || pendingAttachments.length || pendingShare) ? 'chat-theme-accent-bg text-[#3f2c29] hover:opacity-80' : `opacity-30 ${sendStarting ? 'cursor-wait' : 'cursor-not-allowed'}`}`}>
                      <Send size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* ── portals ────────────────────────── */}
      {mounted && createPortal(
        <>
          <ThinkingDrawer
            open={!!thinkingDrawer}
            parts={thinkingDrawer?.parts || []}
            streaming={thinkingDrawer?.id === 'stream' && isLoading}
            onClose={() => setThinkingDrawer(null)}
          />

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

          <ChatRoutePicker
            open={modelPickerOpen}
            isNight={n}
            choices={enabledModels}
            activeProfileId={activeApiProfile?.id || settings.activeProfileId}
            activeModelId={activeApiModel}
            activeRoute={activeRoute}
            activeCcModel={activeCcModel}
            activeCcEffort={activeCcEffort}
            ccStatus={ccStatus}
            onSelectApiModel={(profileId, modelId) => {
              if (activeSession) setGenerationRoute(activeSession.id, 'api')
              if (activeSession) setWindowConfig(activeSession.id, current => ({ ...current, apiProfileId: profileId, apiModelId: modelId }))
              setModelPickerOpen(false)
            }}
            onSelectCc={(modelId) => {
              if (activeSession && ccStatus.available) {
                setCcModel(activeSession.id, modelId)
                setGenerationRoute(activeSession.id, 'claude-code')
              }
            }}
            onSelectCcEffort={(effort) => {
              if (activeSession) setWindowConfig(activeSession.id, current => ({ ...current, ccEffort: effort }))
            }}
            onClose={() => setModelPickerOpen(false)}
          />

          <ChatWindowSettings
            open={windowSettingsOpen}
            session={activeSession}
            ccStatus={ccStatus}
            chatBusy={isLoading || sendStarting}
            onClose={() => setWindowSettingsOpen(false)}
            onRefreshCc={refreshCcStatus}
            onCompacted={() => setContextWarning(null)}
            onDefaultPrompt={() => { setWindowSettingsOpen(false); openChatSettings('star') }}
            onSummary={() => { setWindowSettingsOpen(false); setSummaryDialogOpen(true) }}
          />

          <AnimatePresence>
            {favoriteChatContext && (
              <>
                <motion.button type="button" aria-label="关闭原聊天" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setFavoriteChatContext(null)} className="fixed inset-0 z-[76] bg-black/45 backdrop-blur-[2px]" />
                <motion.section role="dialog" aria-modal="true" aria-label="收藏的原聊天" initial={{ opacity: 0, scale: .97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .97, y: 8 }} className="chat-theme chat-theme-border fixed inset-x-3 bottom-3 top-[max(.75rem,env(safe-area-inset-top))] z-[77] mx-auto flex max-w-2xl flex-col overflow-hidden rounded-[28px] border shadow-2xl">
                  <header className="flex items-start justify-between gap-3 border-b border-current/10 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{favoriteChatContext.sessionTitle}</p><p className="mt-0.5 text-[9px] opacity-40">原聊天 · 第 {favoriteChatContext.targetIndex + 1}/{favoriteChatContext.total} 条附近</p></div><button type="button" aria-label="关闭" onClick={() => setFavoriteChatContext(null)} className="rounded-full p-1.5 opacity-55"><X size={16}/></button></header>
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">{favoriteChatContext.messages.map(message => {
                    const target = message.id === favoriteChatContext.targetMessageId
                    return <article key={message.id} className={`rounded-2xl border px-3 py-2.5 ${target ? 'chat-theme-border chat-theme-accent-soft' : 'border-current/10'}`}>
                      <div className="mb-1 flex items-center justify-between text-[9px] opacity-45"><span>{message.role === 'user' ? '🦦 小火' : '🐆 星星'}</span><span>{fmtFullTs(message.timestamp)}</span></div>
                      <div className="text-xs leading-6"><MarkdownText content={message.content || '（这条消息没有文字内容）'}/></div>
                      {target && <div className="chat-theme-accent mt-2 text-right text-[9px]">收藏原文</div>}
                    </article>
                  })}</div>
                </motion.section>
              </>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {todoOpen && (
              <>
                <motion.button type="button" aria-label="关闭 Todo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setTodoOpen(false)} className="fixed inset-0 z-[74] bg-black/35 backdrop-blur-[2px]" />
                <motion.section role="dialog" aria-modal="true" aria-label="Todo" initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .97 }} className="pointer-events-none fixed inset-0 z-[75] overflow-hidden">
                  <TodoView />
                </motion.section>
              </>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {roomPanel && (
              <>
                <motion.button type="button" aria-label={`关闭 ${roomLabels[roomPanel]}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setRoomPanel(null)} className="fixed inset-0 z-[74] bg-black/35 backdrop-blur-[2px]" />
                <motion.section role="dialog" aria-modal="true" aria-label={roomLabels[roomPanel]} initial={{ opacity: 0, scale: .97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .97, y: 8 }} className={`fixed inset-x-3 bottom-3 top-[max(.75rem,env(safe-area-inset-top))] z-[75] mx-auto flex max-w-6xl flex-col overflow-hidden rounded-[28px] ${n ? 'border border-night-border bg-night-surface text-night-text shadow-2xl' : 'chat-dialog'}`}>
                  <header className="flex justify-end px-3 py-1">
                    <button type="button" aria-label="关闭" onClick={() => setRoomPanel(null)} className="rounded-full p-2 opacity-55 hover:opacity-100"><X size={18}/></button>
                  </header>
                  <div className="min-h-0 flex-1 overflow-hidden">{roomPanel === 'notes' ? <NotesView /> : roomPanel === 'diary' ? <DiaryView /> : roomPanel === 'photos' ? <PhotosView /> : roomPanel === 'poems' ? <PoemsView /> : roomPanel === 'stories' ? <StoriesView /> : roomPanel === 'research' ? <ResearchView /> : roomPanel === 'future' ? <FutureLetterView /> : roomPanel === 'dictionary' ? <FireDictionaryView /> : roomPanel === 'wake' ? <DreamsView fixedTab="reality" /> : roomPanel === 'memory' ? <MemoryView /> : roomPanel === 'favorites' ? <FavoritesView /> : roomPanel === 'wishlist' ? <WishlistView /> : roomPanel === 'media' ? <MediaLibraryView /> : roomPanel === 'energy' ? <EnergyView /> : roomPanel === 'timeline' ? <TimelineView /> : <TesisView />}</div>
                </motion.section>
              </>
            )}
          </AnimatePresence>

          {/* confirm dialog */}
          <AnimatePresence>
            {confirmState && (
              <>
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[70] bg-black/40 backdrop-blur-sm" onClick={() => answer(false)} />
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                  className="chat-theme chat-theme-border fixed inset-x-0 z-[71] mx-auto w-[min(340px,calc(100vw-3rem))] rounded-2xl border p-6 shadow-2xl"
                  style={{ top: 'max(env(safe-area-inset-top, 0px) + 30dvh, 30dvh)', transform: 'translateY(-50%)' }}>
                  <p className="text-sm mb-6">{confirmState.msg}</p>
                  <div className="flex justify-end gap-3">
                    <button onClick={() => answer(false)} className="px-4 py-2 text-sm opacity-60 hover:opacity-100">取消</button>
                    <button onClick={() => answer(true)} className="chat-theme-accent-bg rounded-lg px-4 py-2 text-sm font-medium text-[#3f2c29]">确认</button>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>

          {/* settings / model / bookmark dialogs */}
          <ChatSettings initialPanel={chatSettingsPanel} onCoupons={() => window.dispatchEvent(new CustomEvent('lumbre-open-coupons'))} onTodo={() => setTodoOpen(true)} onNotes={() => setRoomPanel('notes')} onDiary={() => setRoomPanel('diary')} onPhotos={() => setRoomPanel('photos')} onPoems={() => setRoomPanel('poems')} onStories={() => setRoomPanel('stories')} onResearch={() => setRoomPanel('research')} onFutureLetter={() => setRoomPanel('future')} onDictionary={() => setRoomPanel('dictionary')} onFavorites={() => setRoomPanel('favorites')} onWishlist={() => setRoomPanel('wishlist')} onMedia={() => setRoomPanel('media')} onEnergy={() => setRoomPanel('energy')} onTimeline={() => setRoomPanel('timeline')} onTesis={() => setRoomPanel('tesis')} open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          <ModelDialog open={modelDialogOpen} onClose={() => setModelDialogOpen(false)} />
          <SummaryDialog open={summaryDialogOpen} onClose={() => setSummaryDialogOpen(false)} session={activeSession} generating={summaryGenerating} stageGenerating={stageSummaryGenerating} error={summaryError} onGenerate={() => { summaryAttemptRef.current = ''; void generateNextSummary(false) }} onRegenerate={(summary) => { void regenerateSummary(summary) }} onRegenerateStage={(stage) => { void regenerateStageSummary(stage) }} />
          <BookmarkDialog open={bookmarkDialogOpen} onClose={() => setBookmarkDialogOpen(false)} />
          <TimelineTimerModal open={timelineOpen} current={timelineCurrent} onClose={() => setTimelineOpen(false)} onChanged={() => refreshTimelineCurrent()} />
          <MessageReceiptDialog message={receiptMessage} settings={settings} night={n} onClose={() => setReceiptMessage(null)} />
          <IntimacyWheelModal open={wheelOpen} night={n} onClose={() => setWheelOpen(false)} />
        </>,
        document.body,
      )}


    </>
  )
}
