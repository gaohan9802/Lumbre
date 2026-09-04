/**
 * Chat store — local-first chat OS.
 * Sessions, provider metadata, model lists, bookmarks and appearance live in
 * localStorage and sync across devices. Provider credentials never do: API
 * keys and upstream URLs live only in the server-side model credential store.
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  ApiProfile, Bookmark, ChatMessage, ChatSession, ChatSettings, ChatSummary,
  MessageVersion, ProviderModel, SessionSummaryConfig, StageSummary,
} from '@/features/chat/state/types'
import {
  DEFAULT_ANTHROPIC_BASE, DEFAULT_APPEARANCE, DEFAULT_OPENAI_BASE,
  DEFAULT_SETTINGS,
} from '@/features/chat/state/defaults'
import {
  isBlankSession, mergeChatSessionsForSync, mergeSummaryLayer,
} from '@/features/chat/sessions/merge'
import { snapshotOfMessage } from '@/features/chat/sessions/messages'
import { estimateMsgCost, estimateTokens, findModelMeta } from '@/features/chat/usage/cost'
import { getTriggeredBookmarks } from '@/features/chat/summaries/bookmarks'
import {
  backupMigratedChatState, CHAT_STORAGE_KEY, CHAT_STORAGE_VERSION,
  partializeChatState, quotaSafeStorage as chatStorage,
} from '@/features/chat/state/persistence'
import {
  captureLegacyCredentials, completeLegacyModelCredentialMigration,
  getPendingLegacyModelCredentials, normalizeSettings,
} from '@/features/chat/migrations/browser-state'
import { getActiveSession, sortedSessions } from '@/features/chat/state/accessors'
import { createModelSettingsActions } from '@/features/chat/settings/model-actions'
import { createSummaryBookmarkActions } from '@/features/chat/summaries/actions'
import { createMessageActions } from '@/features/chat/messages/actions'
import { createSessionActions } from '@/features/chat/sessions/actions'
import { createChatPreferenceActions } from '@/features/chat/settings/preferences-actions'

export type {
  ApiProfile, ApiProvider, Bookmark, ChatAppearance, ChatMessage, ChatSession,
  ChatSettings, ChatSummary, ContentBlock, MessageVersion, ProviderModel,
  SessionSummaryConfig, StageSummary,
} from '@/features/chat/state/types'
export { DEFAULT_ANTHROPIC_BASE, DEFAULT_APPEARANCE, DEFAULT_OPENAI_BASE }
export { isBlankSession, mergeChatSessionsForSync, mergeSummaryLayer }
export { snapshotOfMessage }
export { estimateMsgCost, estimateTokens, findModelMeta, getTriggeredBookmarks }
export { completeLegacyModelCredentialMigration, getPendingLegacyModelCredentials }

interface ChatStore {
  settings: ChatSettings
  messages: ChatMessage[]

  addMessage: (m: ChatMessage) => void
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void
  clearMessages: () => void
  setSettings: (patch: Partial<ChatSettings>) => void
  resetSettings: () => void

  createSession: () => string
  ensureSession: (id: string, title: string, activate?: boolean) => string
  setActiveSession: (id: string) => void
  deleteMessage: (id: string) => void
  truncateFrom: (id: string) => void
  branchFromMessage: (id: string) => string
  addMessageVersion: (id: string, v: MessageVersion) => void
  switchMessageVersion: (id: string, index: number) => void
  deleteMessageVersion: (id: string, index: number) => void
  mergeRemote: (sessions: ChatSession[], tombstones: Record<string, number>) => void
  prependSessionMessages: (sessionId: string, messages: ChatMessage[], total: number) => void
  mergeRemoteConfig: (config: any, ts: number) => void
  renameSession: (id: string, title: string) => void
  deleteSession: (id: string) => void
  togglePinSession: (id: string) => void

  addApiProfile: (profile: Omit<ApiProfile, 'id' | 'models'> & { id?: string; models?: ProviderModel[] }) => void
  updateApiProfile: (id: string, patch: Partial<ApiProfile>) => void
  deleteApiProfile: (id: string) => void
  setActiveProfile: (id: string, modelId?: string) => void
  setActiveModel: (profileId: string, modelId: string) => void
  setProviderModels: (profileId: string, models: ProviderModel[], merge?: boolean) => void
  toggleModelEnabled: (profileId: string, modelId: string) => void
  addManualModel: (profileId: string, modelId: string) => void
  setAllModelsEnabled: (profileId: string, enabled: boolean) => void
  updateModelMeta: (profileId: string, modelId: string, patch: Partial<ProviderModel>) => void
  deleteModel: (profileId: string, modelId: string) => void

  continueSession: (tailCount?: number) => string

  addBookmark: (b: Omit<Bookmark, 'id'>) => void
  updateBookmark: (id: string, patch: Partial<Bookmark>) => void
  deleteBookmark: (id: string) => void
  addSummary: (sessionId: string, summary: ChatSummary) => void
  updateSummary: (sessionId: string, id: string, patch: Partial<ChatSummary>) => void
  addStageSummary: (sessionId: string, summary: StageSummary) => void
  deleteSummary: (sessionId: string, id: string) => void
  updateSessionSummaryConfig: (sessionId: string, patch: Partial<SessionSummaryConfig>) => void
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      settings: DEFAULT_SETTINGS,
      messages: [],

      ...createMessageActions(set),
      ...createSessionActions(set),
      ...createChatPreferenceActions(set),
      ...createModelSettingsActions(set),

      ...createSummaryBookmarkActions(set),
    }),
    {
      name: CHAT_STORAGE_KEY,
      storage: createJSONStorage(() => chatStorage),
      // `messages` mirrors the active session and used to be persisted a second
      // time at the top level. Long active chats were therefore serialized and
      // parsed twice on every write/startup. Rehydrate rebuilds this mirror.
      partialize: (state) => partializeChatState(normalizeSettings(state.settings)) as any,
      version: CHAT_STORAGE_VERSION,
      migrate: (persisted: any, fromVersion: number) => {
        if (!persisted || typeof persisted !== 'object') return persisted
        const state = persisted.state && typeof persisted.state === 'object' ? persisted.state : persisted
        const raw = state.settings || {}
        captureLegacyCredentials(raw.apiProfiles)
        if (Array.isArray(state.messages) && !raw.sessions) raw.messages = state.messages
        const settings = normalizeSettings(raw)
        state.settings = settings
        state.messages = getActiveSession(settings)?.messages || []
        backupMigratedChatState(settings, fromVersion)
        return persisted
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return
        const settings = normalizeSettings(state.settings)
        state.settings = settings
        state.messages = getActiveSession(settings)?.messages || []
      },
    },
  ),
)

export function getActiveProfile(settings: ChatSettings): ApiProfile | undefined {
  return settings.apiProfiles.find((p) => p.id === settings.activeProfileId) || settings.apiProfiles[0]
}

export function getActiveSessionFromSettings(settings: ChatSettings): ChatSession {
  return getActiveSession(settings)
}

export function getEnabledModels(settings: ChatSettings) {
  return settings.apiProfiles.flatMap((profile) =>
    profile.models.filter((m) => m.enabled).map((model) => ({ profile, model })),
  )
}

export function getSortedSessions(settings: ChatSettings) {
  return sortedSessions(settings.sessions)
}

export function extractConfig(s: ChatSettings) {
  return {
    systemPrompt: s.systemPrompt,
    contextLength: s.contextLength,
    model: s.model,
    thinkingBudget: s.thinkingBudget,
    temperature: s.temperature,
    streamEnabled: s.streamEnabled,
    promptCaching: s.promptCaching,
    appearance: s.appearance,
    activeProfileId: s.activeProfileId,
    apiProfiles: s.apiProfiles.map(profile => ({
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      defaultModel: profile.defaultModel,
      models: profile.models,
      lastFetchedAt: profile.lastFetchedAt,
      credentialConfigured: profile.credentialConfigured === true,
      upstreamOrigin: profile.upstreamOrigin,
    })),
    starStatus: s.starStatus,
    bookmarks: s.bookmarks,
    summaryTurnSize: s.summaryTurnSize,
    summaryInjectCount: s.summaryInjectCount,
  }
}
