import { DEFAULT_SETTINGS, makeChatId } from '@/features/chat/state/defaults'
import { getActiveSession, sortedSessions } from '@/features/chat/state/accessors'
import { normalizeSettings } from '@/features/chat/migrations/browser-state'
import { isBlankSession, mergeChatSessionsForSync } from '@/features/chat/sessions/merge'
import type { ChatMessage, ChatSession, ChatSettings, MessageVersion } from '@/features/chat/state/types'

type ChatState = { settings: ChatSettings; messages: ChatMessage[] }
type SetChatState = (updater: (state: ChatState) => Partial<ChatState> | ChatState) => void

export interface SessionActions {
  createSession: () => string
  ensureSession: (id: string, title: string, activate?: boolean) => string
  setActiveSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  deleteSession: (id: string) => void
  branchFromMessage: (id: string) => string
  mergeRemote: (sessions: ChatSession[], tombstones: Record<string, number>) => void
  prependSessionMessages: (sessionId: string, messages: ChatMessage[], total: number) => void
  mergeRemoteConfig: (config: any, timestamp: number) => void
  togglePinSession: (id: string) => void
  continueSession: (tailCount?: number) => string
}

const makeId = makeChatId

export function createSessionActions(set: SetChatState): SessionActions {
  return {
    createSession: () => {
      const id = makeId('session')
      const now = Date.now()
      set((state) => {
        const settings = normalizeSettings(state.settings)
        const nextSession = { id, title: '新的对话', messages: [], pinned: false, createdAt: now, updatedAt: now }
        return { settings: { ...settings, sessions: [nextSession, ...settings.sessions], activeSessionId: id }, messages: [] }
      })
      return id
    },

    ensureSession: (id, title, activate = true) => {
      const now = Date.now()
      set((state) => {
        const settings = normalizeSettings(state.settings)
        const existing = settings.sessions.find((session) => session.id === id)
        const sessions = existing ? settings.sessions : [{ id, title, messages: [], pinned: false, createdAt: now, updatedAt: now }, ...settings.sessions]
        const nextSettings = { ...settings, sessions, activeSessionId: activate ? id : settings.activeSessionId }
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      })
      return id
    },

    setActiveSession: (id) => set((state) => {
      const settings = normalizeSettings(state.settings)
      if (!settings.sessions.some((s) => s.id === id)) return state
      const nextSettings = { ...settings, activeSessionId: id }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    renameSession: (id, title) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((s) => s.id === id ? { ...s, title: title.trim() || '未命名对话', updatedAt: Date.now() } : s)
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    deleteSession: (id) => set((state) => {
      const settings = normalizeSettings(state.settings)
      let sessions = settings.sessions.filter((s) => s.id !== id)
      if (!sessions.length) sessions = [{ id: makeId('session'), title: '新的对话', messages: [], pinned: false, createdAt: Date.now(), updatedAt: Date.now() }]
      const activeSessionId = settings.activeSessionId === id ? sortedSessions(sessions)[0].id : settings.activeSessionId
      const tombstones = { ...settings.tombstones, [id]: Date.now() }
      const nextSettings = normalizeSettings({ ...settings, sessions, activeSessionId, tombstones })
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    branchFromMessage: (id) => {
      const newId = makeId('session')
      set((state) => {
        const settings = normalizeSettings(state.settings)
        const active = getActiveSession(settings)
        const idx = active.messages.findIndex((m) => m.id === id)
        if (idx < 0) return state
        const now = Date.now()
        const branchMessageIds = new Set(active.messages.slice(0, idx + 1).map((m) => m.id))
        const branch: ChatSession = {
          id: newId,
          title: `${active.title} · 分支`,
          messages: active.messages.slice(0, idx + 1).map((m) => ({ ...m })),
          summaries: (active.summaries || []).filter((summary) => summary.sourceMessageIds?.length
            ? summary.sourceMessageIds.every((messageId) => branchMessageIds.has(messageId))
            : branchMessageIds.has(summary.coveredUntilMessageId)).map((summary) => ({ ...summary, id: makeId('sum'), sessionId: newId })),
          stageSummaries: [],
          summaryConfig: { ...(active.summaryConfig || { autoEnabled: true, turnSize: settings.summaryTurnSize, injectCount: settings.summaryInjectCount }), modeVersion: 2, anchorMessageId: active.messages[idx]?.id, anchorTimestamp: active.messages[idx]?.timestamp },
          pinned: false,
          createdAt: now,
          updatedAt: now,
        }
        const nextSettings = { ...settings, sessions: [branch, ...settings.sessions], activeSessionId: newId }
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      })
      return newId
    },

    mergeRemote: (remoteSessions, remoteTombstones) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const tombstones: Record<string, number> = { ...settings.tombstones }
      for (const [tid, ts] of Object.entries(remoteTombstones || {})) {
        tombstones[tid] = Math.max(tombstones[tid] || 0, ts as number)
      }
      const map = new Map(settings.sessions.map((s) => [s.id, s]))
      for (const rs of remoteSessions || []) {
        if (!rs?.id) continue
        const cur = map.get(rs.id)
        map.set(rs.id, cur ? mergeChatSessionsForSync(cur, rs) : rs)
      }
      let sessions = Array.from(map.values()).filter((s) => !(tombstones[s.id] && tombstones[s.id] >= (s.updatedAt || 0)))
      // drop stale blank sessions (keep the active one so a freshly created empty chat survives)
      const keepId = settings.activeSessionId
      sessions = sessions.filter((s) => s.id === keepId || !isBlankSession(s))
      if (!sessions.length) sessions = [{ id: makeId('session'), title: '新的对话', messages: [], pinned: false, createdAt: Date.now(), updatedAt: Date.now() }]
      const activeSessionId = sessions.some((s) => s.id === settings.activeSessionId) ? settings.activeSessionId : sortedSessions(sessions)[0].id
      const nextSettings = normalizeSettings({ ...settings, sessions, activeSessionId, tombstones })
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    prependSessionMessages: (sessionId, incoming, total) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((session) => {
        if (session.id !== sessionId) return session
        const byId = new Map<string, ChatMessage>()
        for (const message of [...incoming, ...session.messages]) {
          if (message?.id) byId.set(message.id, message)
        }
        const messages = Array.from(byId.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
        const messageCount = Math.max(Number(total) || 0, messages.length)
        return { ...session, messages, messageCount, partial: messages.length < messageCount }
      })
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    mergeRemoteConfig: (config, ts) => set((state) => {
      const settings = normalizeSettings(state.settings)
      if (!config || !(ts > (settings.configUpdatedAt || 0))) return state
      const nextSettings = normalizeSettings({ ...settings, ...config, configUpdatedAt: ts })
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    togglePinSession: (id) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const sessions = settings.sessions.map((s) => s.id === id ? { ...s, pinned: !s.pinned, updatedAt: Date.now() } : s)
      const nextSettings = { ...settings, sessions }
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),

    continueSession: (tailCount = 50) => {
      const id = makeId('session')
      const now = Date.now()
      set((state) => {
        const settings = normalizeSettings(state.settings)
        const active = getActiveSession(settings)
        const tail = active.messages.slice(-Math.max(1, tailCount)).map((m) => ({
          ...m,
          images: m.images ? [...m.images] : undefined,
          versions: m.versions ? m.versions.map((v) => ({ ...v })) : undefined,
          tool_calls: m.tool_calls ? m.tool_calls.map((tc) => ({ ...tc, input: { ...tc.input } })) : undefined,
          content_blocks: m.content_blocks ? m.content_blocks.map((block) => ({ ...block, input: block.input ? { ...block.input } : undefined })) : undefined,
        }))
        const nextSession: ChatSession = {
          id,
          title: `${active.title || '对话'} · 续窗`,
          messages: tail,
          summaries: (active.summaries || []).slice(-(active.summaryConfig?.injectCount || settings.summaryInjectCount)).map((summary, index, copied) => ({ ...summary, id: makeId('sum'), sessionId: id, coveredUntilMessageId: index === copied.length - 1 ? (tail[tail.length - 1]?.id || summary.coveredUntilMessageId) : summary.coveredUntilMessageId })),
          stageSummaries: [],
          summaryConfig: { ...(active.summaryConfig || { autoEnabled: true, turnSize: settings.summaryTurnSize, injectCount: settings.summaryInjectCount }), modeVersion: 2, anchorMessageId: tail[tail.length - 1]?.id, anchorTimestamp: tail[tail.length - 1]?.timestamp },
          pinned: false,
          createdAt: now,
          updatedAt: now,
          messageCount: tail.length,
        }
        const nextSettings = { ...settings, sessions: [nextSession, ...settings.sessions], activeSessionId: id }
        return { settings: nextSettings, messages: tail }
      })
      return id
    },
  }
}
