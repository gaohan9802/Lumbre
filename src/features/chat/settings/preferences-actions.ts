import { DEFAULT_SETTINGS } from '@/features/chat/state/defaults'
import { bumpConfig, getActiveSession } from '@/features/chat/state/accessors'
import { normalizeSettings } from '@/features/chat/migrations/browser-state'
import type { ChatMessage, ChatSettings } from '@/features/chat/state/types'

type ChatState = { settings: ChatSettings; messages: ChatMessage[] }
type SetChatState = (next: Partial<ChatState> | ((state: ChatState) => Partial<ChatState> | ChatState)) => void

export interface ChatPreferenceActions {
  setSettings: (patch: Partial<ChatSettings>) => void
  resetSettings: () => void
}

export function createChatPreferenceActions(set: SetChatState): ChatPreferenceActions {
  return {
    setSettings: patch => set(state => {
      const nextSettings = bumpConfig(normalizeSettings({ ...state.settings, ...patch }))
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),
    resetSettings: () => set({
      settings: { ...DEFAULT_SETTINGS, configUpdatedAt: Date.now() },
      messages: [],
    }),
  }
}
