import { makeChatId } from '@/features/chat/state/defaults'
import { bumpConfig, getActiveSession } from '@/features/chat/state/accessors'
import { normalizeSettings } from '@/features/chat/migrations/browser-state'
import type {
  Bookmark, ChatMessage, ChatSettings, ChatSummary, SessionSummaryConfig, StageSummary,
} from '@/features/chat/state/types'

type ChatState = { settings: ChatSettings; messages: ChatMessage[] }
type SetChatState = (updater: (state: ChatState) => Partial<ChatState> | ChatState) => void

export interface SummaryBookmarkActions {
  addBookmark: (bookmark: Omit<Bookmark, 'id'>) => void
  updateBookmark: (id: string, patch: Partial<Bookmark>) => void
  deleteBookmark: (id: string) => void
  addSummary: (sessionId: string, summary: ChatSummary) => void
  updateSummary: (sessionId: string, id: string, patch: Partial<ChatSummary>) => void
  addStageSummary: (sessionId: string, summary: StageSummary) => void
  deleteSummary: (sessionId: string, id: string) => void
  updateSessionSummaryConfig: (sessionId: string, patch: Partial<SessionSummaryConfig>) => void
}

const makeId = makeChatId

export function createSummaryBookmarkActions(set: SetChatState): SummaryBookmarkActions {
  return {
    addBookmark: (b) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const bookmark: Bookmark = { ...b, id: makeId('bm') }
      const nextSettings = bumpConfig({ ...settings, bookmarks: [...settings.bookmarks, bookmark] })
      return { settings: nextSettings }
    }),

    updateBookmark: (id, patch) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const bookmarks = settings.bookmarks.map((b) => b.id === id ? { ...b, ...patch } : b)
      const nextSettings = bumpConfig({ ...settings, bookmarks })
      return { settings: nextSettings }
    }),

    addSummary: (sessionId, summary) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((session) => session.id === sessionId
        ? { ...session, summaries: [...(session.summaries || []), summary], summaryRevision: (session.summaryRevision || 0) + 1, updatedAt: Date.now() } : session)
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    updateSummary: (sessionId, id, patch) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const contentChanged = Object.prototype.hasOwnProperty.call(patch, 'eventSummary')
      const sessions = settings.sessions.map((session) => {
        if (session.id !== sessionId) return session
        const current = (session.summaries || []).find(item => item.id === id)
        if (!current) return session
        // A locked summary is immutable. The only permitted change is unlocking it.
        if (current.locked && !(Object.keys(patch).length === 1 && patch.locked === false)) return session
        return { ...session, summaries: (session.summaries || []).map((item) => item.id === id ? { ...item, ...patch } : item),
          stageSummaries: contentChanged ? (session.stageSummaries || []).filter(stage => !stage.sourceSummaryIds.includes(id)) : (session.stageSummaries || []), summaryRevision: (session.summaryRevision || 0) + 1, updatedAt: Date.now() }
      })
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    addStageSummary: (sessionId, summary) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((session) => session.id === sessionId
        ? { ...session, stageSummaries: [...(session.stageSummaries || []), summary], summaryRevision: (session.summaryRevision || 0) + 1, updatedAt: Date.now() } : session)
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    deleteSummary: (sessionId, id) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((session) => {
        if (session.id !== sessionId) return session
        const target = (session.summaries || []).find(item => item.id === id)
        if (!target || target.locked) return session
        return { ...session, summaries: (session.summaries || []).filter((item) => item.id !== id), stageSummaries: (session.stageSummaries || []).filter(stage => !stage.sourceSummaryIds.includes(id)), summaryRevision: (session.summaryRevision || 0) + 1, updatedAt: Date.now() }
      })
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    updateSessionSummaryConfig: (sessionId, patch) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((session) => {
        if (session.id !== sessionId) return session
        const base = session.summaryConfig || { autoEnabled: true, turnSize: settings.summaryTurnSize, injectCount: settings.summaryInjectCount, modeVersion: 2 as const }
        // The auto switch controls scheduling only. It must never move the
        // summary boundary or silently mark messages as covered.
        return { ...session, summaryConfig: { ...base, ...patch, modeVersion: 2 as const }, updatedAt: Date.now() }
      })
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    deleteBookmark: (id) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const bookmarks = settings.bookmarks.filter((b) => b.id !== id)
      const nextSettings = bumpConfig({ ...settings, bookmarks })
      return { settings: nextSettings }
    }),
  }
}
