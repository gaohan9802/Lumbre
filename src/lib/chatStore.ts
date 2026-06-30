/**
 * Chat store — zustand + localStorage persist.
 * Local-first: messages + API profiles stay in this browser.
 * API keys are never committed or stored on the server; /api/chat only proxies them per request.
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  thinking?: string
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_creation_tokens?: number
}

export type ApiProvider = 'anthropic' | 'openai-compatible'

export interface ApiProfile {
  id: string
  name: string
  provider: ApiProvider
  baseUrl: string
  apiKey: string
  defaultModel: string
}

export interface ChatSettings {
  systemPrompt: string
  contextLength: number
  model: string
  thinkingBudget: number
  promptCaching: boolean
  activeProfileId: string
  apiProfiles: ApiProfile[]
}

export const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com'
export const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1'

const DEFAULT_PROFILE_ID = 'anthropic-default'

const DEFAULT_SETTINGS: ChatSettings = {
  systemPrompt: '',
  contextLength: 30,
  model: 'claude-sonnet-4-20250514',
  thinkingBudget: 8000,
  promptCaching: true,
  activeProfileId: DEFAULT_PROFILE_ID,
  apiProfiles: [
    {
      id: DEFAULT_PROFILE_ID,
      name: 'Anthropic',
      provider: 'anthropic',
      baseUrl: DEFAULT_ANTHROPIC_BASE,
      apiKey: '',
      defaultModel: 'claude-sonnet-4-20250514',
    },
  ],
}

interface ChatStore {
  messages: ChatMessage[]
  settings: ChatSettings

  addMessage: (m: ChatMessage) => void
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void
  clearMessages: () => void
  setSettings: (patch: Partial<ChatSettings>) => void
  resetSettings: () => void
  addApiProfile: (profile: Omit<ApiProfile, 'id'> & { id?: string }) => void
  updateApiProfile: (id: string, patch: Partial<ApiProfile>) => void
  deleteApiProfile: (id: string) => void
  setActiveProfile: (id: string) => void
}

function makeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizeSettings(settings: Partial<ChatSettings> | undefined): ChatSettings {
  const base = { ...DEFAULT_SETTINGS, ...(settings || {}) } as ChatSettings
  const profiles = Array.isArray(base.apiProfiles) && base.apiProfiles.length
    ? base.apiProfiles
    : DEFAULT_SETTINGS.apiProfiles
  const activeProfileId = profiles.some((p) => p.id === base.activeProfileId)
    ? base.activeProfileId
    : profiles[0].id
  const activeProfile = profiles.find((p) => p.id === activeProfileId)
  return {
    ...base,
    apiProfiles: profiles,
    activeProfileId,
    model: base.model || activeProfile?.defaultModel || DEFAULT_SETTINGS.model,
  }
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      messages: [],
      settings: DEFAULT_SETTINGS,

      addMessage: (m) => set((s) => ({ messages: [...s.messages, m] })),

      updateMessage: (id, patch) =>
        set((s) => ({
          messages: s.messages.map((msg) => (msg.id === id ? { ...msg, ...patch } : msg)),
        })),

      clearMessages: () => set({ messages: [] }),

      setSettings: (patch) =>
        set((s) => ({ settings: normalizeSettings({ ...s.settings, ...patch }) })),

      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),

      addApiProfile: (profile) => {
        const id = profile.id || makeId()
        const next: ApiProfile = {
          id,
          name: profile.name || 'New API',
          provider: profile.provider || 'anthropic',
          baseUrl: (profile.baseUrl || DEFAULT_ANTHROPIC_BASE).replace(/\/$/, ''),
          apiKey: profile.apiKey || '',
          defaultModel: profile.defaultModel || 'claude-sonnet-4-20250514',
        }
        set((s) => ({
          settings: normalizeSettings({
            ...s.settings,
            apiProfiles: [...s.settings.apiProfiles, next],
            activeProfileId: id,
            model: next.defaultModel,
          }),
        }))
      },

      updateApiProfile: (id, patch) => {
        set((s) => {
          const profiles = s.settings.apiProfiles.map((p) =>
            p.id === id ? { ...p, ...patch, baseUrl: patch.baseUrl ? patch.baseUrl.replace(/\/$/, '') : p.baseUrl } : p,
          )
          const updated = profiles.find((p) => p.id === id)
          const model = s.settings.activeProfileId === id && patch.defaultModel ? patch.defaultModel : s.settings.model
          return { settings: normalizeSettings({ ...s.settings, apiProfiles: profiles, model }) }
        })
      },

      deleteApiProfile: (id) => {
        set((s) => {
          const profiles = s.settings.apiProfiles.filter((p) => p.id !== id)
          const safeProfiles = profiles.length ? profiles : DEFAULT_SETTINGS.apiProfiles
          const activeProfileId = s.settings.activeProfileId === id ? safeProfiles[0].id : s.settings.activeProfileId
          const active = safeProfiles.find((p) => p.id === activeProfileId) || safeProfiles[0]
          return {
            settings: normalizeSettings({
              ...s.settings,
              apiProfiles: safeProfiles,
              activeProfileId,
              model: active.defaultModel,
            }),
          }
        })
      },

      setActiveProfile: (id) => {
        const profile = get().settings.apiProfiles.find((p) => p.id === id)
        if (!profile) return
        set((s) => ({
          settings: normalizeSettings({
            ...s.settings,
            activeProfileId: id,
            model: profile.defaultModel || s.settings.model,
          }),
        }))
      },
    }),
    {
      name: 'starfire-chat',
      storage: createJSONStorage(() => localStorage),
      version: 4,
      migrate: (persisted: any) => {
        if (!persisted?.state) return persisted
        persisted.state.settings = normalizeSettings(persisted.state.settings)
        return persisted
      },
    },
  ),
)

export function getActiveProfile(settings: ChatSettings): ApiProfile | undefined {
  return settings.apiProfiles.find((p) => p.id === settings.activeProfileId) || settings.apiProfiles[0]
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.5)
}
