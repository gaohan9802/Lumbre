import { getActiveSession } from '@/features/chat/state/accessors'
import { normalizeSettings } from '@/features/chat/migrations/browser-state'
import { sessionTitleFromMessage, snapshotOfMessage } from '@/features/chat/sessions/messages'
import type { ChatMessage, ChatSession, ChatSettings, MessageVersion } from '@/features/chat/state/types'

type ChatState = { settings: ChatSettings; messages: ChatMessage[] }
type SetChatState = (updater: (state: ChatState) => Partial<ChatState> | ChatState) => void

export interface MessageActions {
  addMessage: (message: ChatMessage) => void
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void
  clearMessages: () => void
  deleteMessage: (id: string) => void
  truncateFrom: (id: string) => void
  addMessageVersion: (id: string, version: MessageVersion) => void
  switchMessageVersion: (id: string, index: number) => void
  deleteMessageVersion: (id: string, index: number) => void
}

export function createMessageActions(set: SetChatState): MessageActions {
  return {
    addMessage: (m) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((s: ChatSession) => {
        if (s.id !== settings.activeSessionId) return s
        const nextMessages = [...s.messages, m]
        const shouldAutoTitle = s.title === '新的对话' && m.role === 'user' && s.messages.length === 0
        return { ...s, title: shouldAutoTitle ? sessionTitleFromMessage(m.content) : s.title, messages: nextMessages, messageCount: Math.max(s.messageCount || 0, nextMessages.length), updatedAt: Date.now() }
      })
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    updateMessage: (id, patch) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((s) => s.id === settings.activeSessionId
        ? { ...s, messages: s.messages.map((msg) => (msg.id === id ? { ...msg, ...patch } : msg)), updatedAt: Date.now() }
        : s)
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    clearMessages: () => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((s) => s.id === settings.activeSessionId ? { ...s, messages: [], summaries: [], stageSummaries: [], summaryRevision: (s.summaryRevision || 0) + 1, messageCount: 0, updatedAt: Date.now() } : s)
      return { settings: { ...settings, sessions }, messages: [] }
    }),

    deleteMessage: (id) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((s) => {
        if (s.id !== settings.activeSessionId) return s
        const deletedIndex = s.messages.findIndex((m) => m.id === id)
        const messages = s.messages.filter((m) => m.id !== id)
        const summaries = deletedIndex < 0 ? (s.summaries || []) : (s.summaries || []).filter((summary) => {
          if (summary.locked) return true
          if (summary.sourceMessageIds?.length) return !summary.sourceMessageIds.includes(id)
          return !(s.messages[deletedIndex].timestamp >= summary.startAt && s.messages[deletedIndex].timestamp <= summary.endAt)
        })
        const summaryIds = new Set(summaries.map(item => item.id))
        const stageSummaries = (s.stageSummaries || []).filter(stage => stage.sourceSummaryIds.every(id => summaryIds.has(id)))
        return { ...s, messages, summaries, stageSummaries, summaryRevision: summaries.length !== (s.summaries || []).length ? (s.summaryRevision || 0) + 1 : (s.summaryRevision || 0), messageCount: messages.length, updatedAt: Date.now() }
      })
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    truncateFrom: (id) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((s) => {
        if (s.id !== settings.activeSessionId) return s
        const idx = s.messages.findIndex((m) => m.id === id)
        if (idx < 0) return s
        const messages = s.messages.slice(0, idx)
        const keptIds = new Set(messages.map((m) => m.id))
        const summaries = (s.summaries || []).filter((summary) => summary.locked || (summary.sourceMessageIds?.length
          ? summary.sourceMessageIds.every((messageId) => keptIds.has(messageId))
          : keptIds.has(summary.coveredUntilMessageId)))
        const summaryIds = new Set(summaries.map(item => item.id))
        const stageSummaries = (s.stageSummaries || []).filter(stage => stage.sourceSummaryIds.every(id => summaryIds.has(id)))
        return { ...s, messages, summaries, stageSummaries, summaryRevision: summaries.length !== (s.summaries || []).length ? (s.summaryRevision || 0) + 1 : (s.summaryRevision || 0), messageCount: messages.length, updatedAt: Date.now() }
      })
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    addMessageVersion: (id, v) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((s) => {
        if (s.id !== settings.activeSessionId) return s
        return {
          ...s,
          messages: s.messages.map((m) => {
            if (m.id !== id) return m
            const base = m.versions?.length ? m.versions : [snapshotOfMessage(m)]
            const versions = [...base, v]
            return { ...m, ...v, versions, versionIndex: versions.length - 1 }
          }),
          updatedAt: Date.now(),
        }
      })
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    switchMessageVersion: (id, index) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((s) => {
        if (s.id !== settings.activeSessionId) return s
        return {
          ...s,
          messages: s.messages.map((m) => {
            if (m.id !== id || !m.versions?.length) return m
            const i = Math.max(0, Math.min(index, m.versions.length - 1))
            return { ...m, ...m.versions[i], versionIndex: i }
          }),
          updatedAt: Date.now(),
        }
      })
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    deleteMessageVersion: (id, index) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((s) => {
        if (s.id !== settings.activeSessionId) return s
        return {
          ...s,
          messages: s.messages.map((m) => {
            if (m.id !== id || !m.versions || m.versions.length <= 1) return m
            const versions = m.versions.filter((_: MessageVersion, i: number) => i !== index)
            const cur = m.versionIndex ?? m.versions.length - 1
            const nextIndex = Math.max(0, Math.min(cur > index ? cur - 1 : cur, versions.length - 1))
            return { ...m, ...versions[nextIndex], versions, versionIndex: nextIndex }
          }),
          updatedAt: Date.now(),
        }
      })
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),
  }
}
