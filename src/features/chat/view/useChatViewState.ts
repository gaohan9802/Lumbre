'use client'

import { useCallback, useRef, useState, type SetStateAction } from 'react'
import type { TimelineCurrent } from '@/components/timeline/TimelineTimerModal'
import type { ContentBlock } from '@/features/chat/state/types'
import { EMPTY_CHAT_COMPOSER_DRAFT, updateComposerDraft, type ChatComposerDraft } from './composerDrafts'

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
export function useChatViewState(sessionId: string) {
  const [composerDrafts, setComposerDrafts] = useState<Record<string, ChatComposerDraft>>({})
  const composerDraft = composerDrafts[sessionId] || EMPTY_CHAT_COMPOSER_DRAFT
  const setDraftField = useCallback(<K extends keyof ChatComposerDraft>(field: K, action: SetStateAction<ChatComposerDraft[K]>) => {
    setComposerDrafts(current => updateComposerDraft(current, sessionId, field, action))
  }, [sessionId])
  const setInput = useCallback((value: SetStateAction<string>) => setDraftField('input', value), [setDraftField])
  const setPendingImages = useCallback((value: SetStateAction<string[]>) => setDraftField('pendingImages', value), [setDraftField])
  const setPendingAttachments = useCallback((value: SetStateAction<ChatComposerDraft['pendingAttachments']>) => setDraftField('pendingAttachments', value), [setDraftField])
  const setPendingShare = useCallback((value: SetStateAction<ChatComposerDraft['pendingShare']>) => setDraftField('pendingShare', value), [setDraftField])
  const { input, pendingImages, pendingAttachments, pendingShare } = composerDraft
  const [isLoading, setIsLoading] = useState(false)
  const [sendStarting, setSendStarting] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [streamBlocks, setStreamBlocks] = useState<ContentBlock[]>([])
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
  const [sessionDrawerOpen, setSessionDrawerOpen] = useState(false)
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null)
  const [editingMsgText, setEditingMsgText] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [uploadingImg, setUploadingImg] = useState(false)
  const [visibleCount, setVisibleCount] = useState(CHAT_PAGE_SIZE)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [photoPrompt, setPhotoPrompt] = useState<{ messageId: string; images: string[] } | null>(null)
  const [deleteMenuId, setDeleteMenuId] = useState<string | null>(null)
  const [messageActionsId, setMessageActionsId] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const imgInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickBottomRef = useRef(true)
  const abortControllerRef = useRef<AbortController | null>(null)
  const activeGenerationRef = useRef<{ route: 'api' | 'claude-code'; sessionId: string; turnId: string } | null>(null)
  const explicitStopRef = useRef(false)
  const recoveredTurnsRef = useRef<Set<string>>(new Set())
  const sendLockRef = useRef(false)
  const confirm = useConfirm()

  return {
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
    ...confirm,
  }
}
