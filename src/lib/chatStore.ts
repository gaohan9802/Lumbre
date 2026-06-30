/**
 * Chat store — local-first chat OS.
 * Sessions, providers and fetched model lists live in browser localStorage.
 * API keys are sent only per request to /api/* proxy routes.
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
  providerId?: string
  modelId?: string
}

export type ApiProvider = 'anthropic' | 'openai-compatible'

export interface ProviderModel {
  id: string
  name?: string
  ownedBy?: string
  created?: number
  enabled: boolean
}

export interface ApiProfile {
  id: string
  name: string
  provider: ApiProvider
  baseUrl: string
  apiKey: string
  defaultModel: string
  models: ProviderModel[]
  lastFetchedAt?: number
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  pinned: boolean
  createdAt: number
  updatedAt: number
}

export interface ChatSettings {
  systemPrompt: string
  contextLength: number
  model: string
  thinkingBudget: number
  promptCaching: boolean
  activeProfileId: string
  apiProfiles: ApiProfile[]
  activeSessionId: string
  sessions: ChatSession[]
}

export const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com'
export const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1'

const DEFAULT_PROFILE_ID = 'anthropic-default'
const DEFAULT_SESSION_ID = 'session-default'
const NOW = Date.now()

const DEFAULT_ANTHROPIC_MODELS: ProviderModel[] = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', enabled: true },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', enabled: false },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude Haiku 3.5', enabled: false },
]

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
      models: DEFAULT_ANTHROPIC_MODELS,
    },
  ],
  activeSessionId: DEFAULT_SESSION_ID,
  sessions: [
    { id: DEFAULT_SESSION_ID, title: '新的对话', messages: [], pinned: false, createdAt: NOW, updatedAt: NOW },
  ],
}

interface ChatStore {
  settings: ChatSettings
  messages: ChatMessage[] // compatibility mirror for older components

  addMessage: (m: ChatMessage) => void
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void
  clearMessages: () => void
  setSettings: (patch: Partial<ChatSettings>) => void
  resetSettings: () => void

  createSession: () => string
  setActiveSession: (id: string) => void
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
}

function makeId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizeModelId(profile?: ApiProfile, model?: string) {
  return model || profile?.defaultModel || 'claude-sonnet-4-20250514'
}

function sessionTitleFromMessage(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, 24) : '新的对话'
}

function normalizeProfile(p: any): ApiProfile {
  const provider: ApiProvider = p?.provider || 'anthropic'
  const defaultModel = p?.defaultModel || (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o')
  const models = Array.isArray(p?.models) && p.models.length
    ? p.models.map((m: any) => ({ id: m.id || m.name, name: m.name, ownedBy: m.ownedBy || m.owned_by, created: m.created, enabled: m.enabled !== false })).filter((m: any) => m.id)
    : [{ id: defaultModel, name: defaultModel, enabled: true }]
  if (!models.some((m: any) => m.id === defaultModel)) models.unshift({ id: defaultModel, name: defaultModel, enabled: true })
  return {
    id: p?.id || makeId('provider'),
    name: p?.name || 'New API',
    provider,
    baseUrl: (p?.baseUrl || (provider === 'anthropic' ? DEFAULT_ANTHROPIC_BASE : DEFAULT_OPENAI_BASE)).replace(/\/$/, ''),
    apiKey: p?.apiKey || '',
    defaultModel,
    models,
    lastFetchedAt: p?.lastFetchedAt,
  }
}

function normalizeSettings(settings: any): ChatSettings {
  const oldMessages = Array.isArray(settings?.messages) ? settings.messages : []
  const profiles = Array.isArray(settings?.apiProfiles) && settings.apiProfiles.length
    ? settings.apiProfiles.map(normalizeProfile)
    : DEFAULT_SETTINGS.apiProfiles
  const activeProfileId = profiles.some((p: any) => p.id === settings?.activeProfileId)
    ? settings.activeProfileId
    : profiles[0].id
  const activeProfile = profiles.find((p: any) => p.id === activeProfileId) || profiles[0]

  let sessions: ChatSession[] = Array.isArray(settings?.sessions) && settings.sessions.length
    ? settings.sessions.map((s: any) => ({
        id: s.id || makeId('session'),
        title: s.title || '新的对话',
        messages: Array.isArray(s.messages) ? s.messages : [],
        pinned: !!s.pinned,
        createdAt: s.createdAt || Date.now(),
        updatedAt: s.updatedAt || s.createdAt || Date.now(),
      }))
    : [{ ...DEFAULT_SETTINGS.sessions[0], messages: oldMessages }]

  let activeSessionId = sessions.some((s) => s.id === settings?.activeSessionId)
    ? settings.activeSessionId
    : sessions[0].id

  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    apiProfiles: profiles,
    activeProfileId,
    model: normalizeModelId(activeProfile, settings?.model),
    sessions,
    activeSessionId,
  }
}

function getActiveSession(settings: ChatSettings) {
  return settings.sessions.find((s) => s.id === settings.activeSessionId) || settings.sessions[0]
}

function sortedSessions(sessions: ChatSession[]) {
  return [...sessions].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      messages: [],

      addMessage: (m) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const sessions = settings.sessions.map((s) => {
          if (s.id !== settings.activeSessionId) return s
          const nextMessages = [...s.messages, m]
          const shouldAutoTitle = s.title === '新的对话' && m.role === 'user' && s.messages.length === 0
          return { ...s, title: shouldAutoTitle ? sessionTitleFromMessage(m.content) : s.title, messages: nextMessages, updatedAt: Date.now() }
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
        const sessions = settings.sessions.map((s) => s.id === settings.activeSessionId ? { ...s, messages: [], updatedAt: Date.now() } : s)
        return { settings: { ...settings, sessions }, messages: [] }
      }),

      setSettings: (patch) => set((state) => {
        const nextSettings = normalizeSettings({ ...state.settings, ...patch })
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      resetSettings: () => set({ settings: DEFAULT_SETTINGS, messages: [] }),

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
        const nextSettings = { ...settings, sessions, activeSessionId }
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      togglePinSession: (id) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const sessions = settings.sessions.map((s) => s.id === id ? { ...s, pinned: !s.pinned, updatedAt: Date.now() } : s)
        const nextSettings = { ...settings, sessions }
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      addApiProfile: (profile) => {
        const next = normalizeProfile({ ...profile, id: profile.id || makeId('provider'), models: profile.models })
        set((state) => {
          const settings = normalizeSettings(state.settings)
          const nextSettings = normalizeSettings({ ...settings, apiProfiles: [...settings.apiProfiles, next], activeProfileId: next.id, model: next.defaultModel })
          return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
        })
      },

      updateApiProfile: (id, patch) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const profiles = settings.apiProfiles.map((p) => p.id === id ? normalizeProfile({ ...p, ...patch }) : p)
        const model = settings.activeProfileId === id && patch.defaultModel ? patch.defaultModel : settings.model
        const nextSettings = normalizeSettings({ ...settings, apiProfiles: profiles, model })
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      deleteApiProfile: (id) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const profiles = settings.apiProfiles.filter((p) => p.id !== id)
        const safeProfiles = profiles.length ? profiles : DEFAULT_SETTINGS.apiProfiles
        const activeProfileId = settings.activeProfileId === id ? safeProfiles[0].id : settings.activeProfileId
        const active = safeProfiles.find((p) => p.id === activeProfileId) || safeProfiles[0]
        const nextSettings = normalizeSettings({ ...settings, apiProfiles: safeProfiles, activeProfileId, model: active.defaultModel })
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      setActiveProfile: (id, modelId) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const profile = settings.apiProfiles.find((p) => p.id === id)
        if (!profile) return state
        const nextSettings = normalizeSettings({ ...settings, activeProfileId: id, model: modelId || profile.defaultModel })
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      setActiveModel: (profileId, modelId) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const profiles = settings.apiProfiles.map((p) => p.id === profileId ? { ...p, defaultModel: modelId } : p)
        const nextSettings = normalizeSettings({ ...settings, apiProfiles: profiles, activeProfileId: profileId, model: modelId })
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      setProviderModels: (profileId, models, merge = true) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const profiles = settings.apiProfiles.map((p) => {
          if (p.id !== profileId) return p
          const oldMap = new Map(p.models.map((m) => [m.id, m]))
          const nextModels = models.map((m) => ({ ...m, enabled: merge ? (oldMap.get(m.id)?.enabled ?? true) : m.enabled !== false }))
          if (merge) {
            for (const old of p.models) if (!nextModels.some((m) => m.id === old.id)) nextModels.push(old)
          }
          const defaultModel = nextModels.find((m) => m.enabled)?.id || p.defaultModel
          return { ...p, models: nextModels, defaultModel, lastFetchedAt: Date.now() }
        })
        const nextSettings = normalizeSettings({ ...settings, apiProfiles: profiles })
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      toggleModelEnabled: (profileId, modelId) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const profiles = settings.apiProfiles.map((p) => p.id === profileId
          ? { ...p, models: p.models.map((m) => m.id === modelId ? { ...m, enabled: !m.enabled } : m) }
          : p)
        const nextSettings = normalizeSettings({ ...settings, apiProfiles: profiles })
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      addManualModel: (profileId, modelId) => set((state) => {
        const id = modelId.trim()
        if (!id) return state
        const settings = normalizeSettings(state.settings)
        const profiles = settings.apiProfiles.map((p) => p.id === profileId && !p.models.some((m) => m.id === id)
          ? { ...p, models: [{ id, name: id, enabled: true }, ...p.models], defaultModel: p.defaultModel || id }
          : p)
        const nextSettings = normalizeSettings({ ...settings, apiProfiles: profiles })
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),
    }),
    {
      name: 'starfire-chat',
      storage: createJSONStorage(() => localStorage),
      version: 5,
      migrate: (persisted: any) => {
        if (!persisted?.state) return persisted
        const raw = persisted.state.settings || {}
        if (Array.isArray(persisted.state.messages) && !raw.sessions) raw.messages = persisted.state.messages
        const settings = normalizeSettings(raw)
        persisted.state.settings = settings
        persisted.state.messages = getActiveSession(settings)?.messages || []
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

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.5)
}
