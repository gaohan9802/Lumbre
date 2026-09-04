'use client'

import { useCallback, useRef, useState } from 'react'
import type { TimelineCurrent } from '@/components/timeline/TimelineTimerModal'
import type { SharedCard } from '@/lib/share'
import type { ContentBlock } from '@/features/chat/state/types'

export const CHAT_PAGE_SIZE = 50

function useConfirm() {
  const [state, setState] = useState<{ msg: string; resolve: (value: boolean) => void } | null>(null)
  const ask = useCallback((msg: string) => new Promise<boolean>(resolve => setState({ msg, resolve })), [])
  const answer = useCallback((value: boolean) => {
    state?.resolve(value)
    setState(null)
  }, [state])
  return { confirmState: state, ask, answer }
}

/** Ephemeral view state only. Nothing here is persisted or synced. */
export function useChatViewState() {
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
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false)
  const [summaryGenerating, setSummaryGenerating] = useState(false)
  const [summaryError, setSummaryError] = useState('')
  const summaryGeneratingRef = useRef(false)
  const summaryAttemptRef = useRef('')
  const [stageSummaryGenerating, setStageSummaryGenerating] = useState(false)
  const stageAttemptRef = useRef('')
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
  const [modelFilterProvider, setModelFilterProvider] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)
  const [pendingImages, setPendingImages] = useState<string[]>([])
  const [pendingShare, setPendingShare] = useState<SharedCard | null>(null)
  const [visibleCount, setVisibleCount] = useState(CHAT_PAGE_SIZE)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [photoPrompt, setPhotoPrompt] = useState<{ dataUrl: string } | null>(null)
  const [deleteMenuId, setDeleteMenuId] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickBottomRef = useRef(true)
  const abortControllerRef = useRef<AbortController | null>(null)
  const confirm = useConfirm()

  return {
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
    copiedId, setCopiedId, modelFilterProvider, setModelFilterProvider, mounted, setMounted,
    uploadingImg, setUploadingImg, pendingImages, setPendingImages, pendingShare, setPendingShare,
    visibleCount, setVisibleCount, historyLoading, setHistoryLoading, photoPrompt, setPhotoPrompt,
    deleteMenuId, setDeleteMenuId,
    messagesEndRef, inputRef, imgInputRef, scrollRef, stickBottomRef, abortControllerRef,
    ...confirm,
  }
}
