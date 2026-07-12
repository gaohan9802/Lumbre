/**
 * Chat store — local-first chat OS.
 * Sessions, providers, model lists, bookmarks and appearance live in localStorage,
 * and sync across devices through /api/sync (config merged by configUpdatedAt).
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

export interface MessageVersion {
  content: string
  thinking?: string
  timestamp: number
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_creation_tokens?: number
  tool_calls?: { name: string; input: Record<string, any>; result: string }[]
  providerId?: string
  modelId?: string
}

export interface ChatMessage extends MessageVersion {
  id: string
  role: 'user' | 'assistant'
  images?: string[]
  versions?: MessageVersion[]
  versionIndex?: number
}

export type ApiProvider = 'anthropic' | 'openai-compatible'

export interface ProviderModel {
  id: string
  name?: string
  ownedBy?: string
  created?: number
  enabled: boolean
  inputPrice?: number
  outputPrice?: number
  cachePrice?: number
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

export interface ChatAppearance {
  bgImage: string
  bgOpacity: number
  // Day-mode bubbles
  userBubbleColor: string
  userBubbleOpacity: number
  aiBubbleColor: string
  aiBubbleOpacity: number
  // Night-mode bubbles (independent from day)
  userBubbleColorNight: string
  userBubbleOpacityNight: number
  aiBubbleColorNight: string
  aiBubbleOpacityNight: number
}

export const DEFAULT_APPEARANCE: ChatAppearance = {
  bgImage: '',
  bgOpacity: 0.3,
  userBubbleColor: '',
  userBubbleOpacity: 1,
  aiBubbleColor: '',
  aiBubbleOpacity: 1,
  userBubbleColorNight: '',
  userBubbleOpacityNight: 1,
  aiBubbleColorNight: '',
  aiBubbleOpacityNight: 1,
}

export interface Bookmark {
  id: string
  name: string
  keywords: string[]
  content: string
  position: 'start' | 'end'
  scanDepth: number
  priority: number
  alwaysOn: boolean
  enabled: boolean
}

export interface ChatSettings {
  systemPrompt: string
  contextLength: number
  model: string
  thinkingBudget: number
  temperature: number
  streamEnabled: boolean
  promptCaching: boolean
  appearance: ChatAppearance
  activeProfileId: string
  apiProfiles: ApiProfile[]
  activeSessionId: string
  sessions: ChatSession[]
  tombstones: Record<string, number>
  starStatus?: { text: string; timestamp: number; msgCount?: number }
  bookmarks: Bookmark[]
  configUpdatedAt: number
}

export const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com'
export const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1'

const DEFAULT_PROFILE_ID = 'anthropic-default'
function genId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}
const DEFAULT_SESSION_ID = genId('session')
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
  temperature: 1,
  streamEnabled: false,
  promptCaching: true,
  appearance: DEFAULT_APPEARANCE,
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
  tombstones: {},
  bookmarks: [],
  configUpdatedAt: 0,
}

interface ChatStore {
  settings: ChatSettings
  messages: ChatMessage[]

  addMessage: (m: ChatMessage) => void
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void
  clearMessages: () => void
  setSettings: (patch: Partial<ChatSettings>) => void
  resetSettings: () => void

  createSession: () => string
  setActiveSession: (id: string) => void
  deleteMessage: (id: string) => void
  truncateFrom: (id: string) => void
  branchFromMessage: (id: string) => string
  addMessageVersion: (id: string, v: MessageVersion) => void
  switchMessageVersion: (id: string, index: number) => void
  deleteMessageVersion: (id: string, index: number) => void
  mergeRemote: (sessions: ChatSession[], tombstones: Record<string, number>) => void
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

  addBookmark: (b: Omit<Bookmark, 'id'>) => void
  updateBookmark: (id: string, patch: Partial<Bookmark>) => void
  deleteBookmark: (id: string) => void
}

const makeId = genId

// A blank session (no messages, not pinned, default/empty title) is pure local
// scratch space; it must never be synced or it accumulates across boots/devices.
export function isBlankSession(s: any) {
  return (s?.messages?.length || 0) === 0 && !s?.pinned && (!s?.title || s.title === '新的对话')
}

// When two sessions share an id, the more recent edit wins so deletions and
// edits actually propagate (deleting a message lowers the count, so a naive
// "more messages wins" would resurrect it). The only guard is that a blank
// scratch session (0 msgs, default title) must never clobber a real one.
function pickSession(a: any, b: any) {
  const aBlank = isBlankSession(a)
  const bBlank = isBlankSession(b)
  if (aBlank && !bBlank) return b
  if (bBlank && !aBlank) return a
  return (b?.updatedAt || 0) > (a?.updatedAt || 0) ? b : a
}

const numOr = (v: any) => (typeof v === 'number' && isFinite(v) ? v : undefined)

function normalizeModelId(profile?: ApiProfile, model?: string) {
  return model || profile?.defaultModel || 'claude-sonnet-4-20250514'
}

function sessionTitleFromMessage(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, 24) : '新的对话'
}

export function snapshotOfMessage(m: ChatMessage): MessageVersion {
  return {
    content: m.content,
    thinking: m.thinking,
    timestamp: m.timestamp,
    input_tokens: m.input_tokens,
    output_tokens: m.output_tokens,
    cache_read_tokens: m.cache_read_tokens,
    cache_creation_tokens: m.cache_creation_tokens,
    tool_calls: m.tool_calls,
    providerId: m.providerId,
    modelId: m.modelId,
  }
}

function normalizeProfile(p: any): ApiProfile {
  const provider: ApiProvider = p?.provider || 'anthropic'
  const defaultModel = p?.defaultModel || (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o')
  const models = Array.isArray(p?.models) && p.models.length
    ? p.models.map((m: any) => ({
        id: m.id || m.name,
        name: m.name,
        ownedBy: m.ownedBy || m.owned_by,
        created: m.created,
        enabled: m.enabled !== false,
        inputPrice: numOr(m.inputPrice),
        outputPrice: numOr(m.outputPrice),
        cachePrice: numOr(m.cachePrice),
      })).filter((m: any) => m.id)
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

  const activeSessionId = sessions.some((s) => s.id === settings?.activeSessionId)
    ? settings.activeSessionId
    : sessions[0].id

  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    apiProfiles: profiles,
    activeProfileId,
    model: normalizeModelId(activeProfile, settings?.model),
    temperature: typeof settings?.temperature === 'number' ? settings.temperature : 1,
    streamEnabled: !!settings?.streamEnabled,
    appearance: { ...DEFAULT_APPEARANCE, ...(settings?.appearance || {}) },
    sessions,
    activeSessionId,
    tombstones: settings?.tombstones && typeof settings.tombstones === 'object' ? settings.tombstones : {},
    bookmarks: Array.isArray(settings?.bookmarks) ? settings.bookmarks : [],
    configUpdatedAt: typeof settings?.configUpdatedAt === 'number' ? settings.configUpdatedAt : 0,
  }
}

function getActiveSession(settings: ChatSettings) {
  return settings.sessions.find((s) => s.id === settings.activeSessionId) || settings.sessions[0]
}

function sortedSessions(sessions: ChatSession[]) {
  return [...sessions].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

function bumpConfig(s: ChatSettings): ChatSettings {
  return { ...s, configUpdatedAt: Date.now() }
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      messages: [],

      addMessage: (m) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const sessions = settings.sessions.map((s: ChatSession) => {
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
        const nextSettings = bumpConfig(normalizeSettings({ ...state.settings, ...patch }))
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      resetSettings: () => set({ settings: { ...DEFAULT_SETTINGS, configUpdatedAt: Date.now() }, messages: [] }),

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
        const tombstones = { ...settings.tombstones, [id]: Date.now() }
        const nextSettings = { ...settings, sessions, activeSessionId, tombstones }
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      deleteMessage: (id) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const sessions = settings.sessions.map((s) => s.id === settings.activeSessionId
          ? { ...s, messages: s.messages.filter((m) => m.id !== id), updatedAt: Date.now() }
          : s)
        const nextSettings = { ...settings, sessions }
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      truncateFrom: (id) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const sessions = settings.sessions.map((s) => {
          if (s.id !== settings.activeSessionId) return s
          const idx = s.messages.findIndex((m) => m.id === id)
          if (idx < 0) return s
          return { ...s, messages: s.messages.slice(0, idx), updatedAt: Date.now() }
        })
        const nextSettings = { ...settings, sessions }
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
          const branch: ChatSession = {
            id: newId,
            title: `${active.title} · 分支`,
            messages: active.messages.slice(0, idx + 1).map((m) => ({ ...m })),
            pinned: false,
            createdAt: now,
            updatedAt: now,
          }
          const nextSettings = { ...settings, sessions: [branch, ...settings.sessions], activeSessionId: newId }
          return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
        })
        return newId
      },

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
          map.set(rs.id, cur ? pickSession(cur, rs) : rs)
        }
        let sessions = Array.from(map.values()).filter((s) => !(tombstones[s.id] && tombstones[s.id] >= (s.updatedAt || 0)))
        // drop stale blank sessions (keep the active one so a freshly created empty chat survives)
        const keepId = settings.activeSessionId
        sessions = sessions.filter((s) => s.id === keepId || !isBlankSession(s))
        if (!sessions.length) sessions = [{ id: makeId('session'), title: '新的对话', messages: [], pinned: false, createdAt: Date.now(), updatedAt: Date.now() }]
        const activeSessionId = sessions.some((s) => s.id === settings.activeSessionId) ? settings.activeSessionId : sortedSessions(sessions)[0].id
        const nextSettings = { ...settings, sessions, activeSessionId, tombstones }
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

      addApiProfile: (profile) => {
        const next = normalizeProfile({ ...profile, id: profile.id || makeId('provider'), models: profile.models })
        set((state) => {
          const settings = normalizeSettings(state.settings)
          const nextSettings = bumpConfig(normalizeSettings({ ...settings, apiProfiles: [...settings.apiProfiles, next], activeProfileId: next.id, model: next.defaultModel }))
          return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
        })
      },

      updateApiProfile: (id, patch) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const profiles = settings.apiProfiles.map((p) => p.id === id ? normalizeProfile({ ...p, ...patch }) : p)
        const model = settings.activeProfileId === id && patch.defaultModel ? patch.defaultModel : settings.model
        const nextSettings = bumpConfig(normalizeSettings({ ...settings, apiProfiles: profiles, model }))
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      deleteApiProfile: (id) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const profiles = settings.apiProfiles.filter((p) => p.id !== id)
        const safeProfiles = profiles.length ? profiles : DEFAULT_SETTINGS.apiProfiles
        const activeProfileId = settings.activeProfileId === id ? safeProfiles[0].id : settings.activeProfileId
        const active = safeProfiles.find((p) => p.id === activeProfileId) || safeProfiles[0]
        const nextSettings = bumpConfig(normalizeSettings({ ...settings, apiProfiles: safeProfiles, activeProfileId, model: active.defaultModel }))
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      setActiveProfile: (id, modelId) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const profile = settings.apiProfiles.find((p) => p.id === id)
        if (!profile) return state
        const nextSettings = bumpConfig(normalizeSettings({ ...settings, activeProfileId: id, model: modelId || profile.defaultModel }))
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      setActiveModel: (profileId, modelId) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const profiles = settings.apiProfiles.map((p) => p.id === profileId ? { ...p, defaultModel: modelId } : p)
        const nextSettings = bumpConfig(normalizeSettings({ ...settings, apiProfiles: profiles, activeProfileId: profileId, model: modelId }))
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      setProviderModels: (profileId, models, merge = true) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const profiles = settings.apiProfiles.map((p) => {
          if (p.id !== profileId) return p
          const oldMap = new Map(p.models.map((m) => [m.id, m]))
          const nextModels: ProviderModel[] = models.map((m) => {
            const old = oldMap.get(m.id)
            return {
              ...m,
              enabled: merge ? (old?.enabled ?? true) : m.enabled !== false,
              inputPrice: m.inputPrice ?? old?.inputPrice,
              outputPrice: m.outputPrice ?? old?.outputPrice,
              cachePrice: m.cachePrice ?? old?.cachePrice,
            }
          })
          if (merge) {
            for (const old of p.models) if (!nextModels.some((m) => m.id === old.id)) nextModels.push(old)
          }
          const defaultModel = nextModels.find((m) => m.enabled)?.id || p.defaultModel
          return { ...p, models: nextModels, defaultModel, lastFetchedAt: Date.now() }
        })
        const nextSettings = bumpConfig(normalizeSettings({ ...settings, apiProfiles: profiles }))
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      toggleModelEnabled: (profileId, modelId) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const profiles = settings.apiProfiles.map((p) => p.id === profileId
          ? { ...p, models: p.models.map((m) => m.id === modelId ? { ...m, enabled: !m.enabled } : m) }
          : p)
        const nextSettings = bumpConfig(normalizeSettings({ ...settings, apiProfiles: profiles }))
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      setAllModelsEnabled: (profileId, enabled) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const profiles = settings.apiProfiles.map((p) => p.id === profileId
          ? { ...p, models: p.models.map((m) => ({ ...m, enabled })) }
          : p)
        const nextSettings = bumpConfig(normalizeSettings({ ...settings, apiProfiles: profiles }))
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),
      addManualModel: (profileId, modelId) => set((state) => {
        const id = modelId.trim()
        if (!id) return state
        const settings = normalizeSettings(state.settings)
        const profiles = settings.apiProfiles.map((p) => p.id === profileId && !p.models.some((m) => m.id === id)
          ? { ...p, models: [{ id, name: id, enabled: true }, ...p.models], defaultModel: p.defaultModel || id }
          : p)
        const nextSettings = bumpConfig(normalizeSettings({ ...settings, apiProfiles: profiles }))
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      updateModelMeta: (profileId, modelId, patch) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const profiles = settings.apiProfiles.map((p) => p.id === profileId
          ? { ...p, models: p.models.map((m) => m.id === modelId ? { ...m, ...patch } : m) }
          : p)
        const nextSettings = bumpConfig({ ...settings, apiProfiles: profiles })
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

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

      deleteBookmark: (id) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const bookmarks = settings.bookmarks.filter((b) => b.id !== id)
        const nextSettings = bumpConfig({ ...settings, bookmarks })
        return { settings: nextSettings }
      }),
    }),
    {
      name: 'starfire-chat',
      storage: createJSONStorage(() => localStorage),
      version: 7,
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
    apiProfiles: s.apiProfiles,
    starStatus: s.starStatus,
    bookmarks: s.bookmarks,
  }
}

export function findModelMeta(settings: ChatSettings, providerId?: string, modelId?: string) {
  const p = settings.apiProfiles.find((x) => x.id === providerId)
  return p?.models.find((m) => m.id === modelId)
}

export function estimateMsgCost(settings: ChatSettings, m: ChatMessage): number {
  const meta = findModelMeta(settings, m.providerId, m.modelId)
  if (!meta) return 0
  const inP = meta.inputPrice || 0
  const outP = meta.outputPrice || 0
  const cacheP = meta.cachePrice || 0
  return ((m.input_tokens || 0) * inP + (m.output_tokens || 0) * outP + (m.cache_read_tokens || 0) * cacheP) / 1e6
}

export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.5)
}

/** Get triggered bookmarks based on recent messages */
export function getTriggeredBookmarks(bookmarks: Bookmark[], recentMessages: ChatMessage[]): Bookmark[] {
  const triggered: Bookmark[] = []
  for (const bm of bookmarks) {
    if (!bm.enabled) continue
    if (bm.alwaysOn) { triggered.push(bm); continue }
    const scanMsgs = recentMessages.slice(-bm.scanDepth)
    const text = scanMsgs.map((m) => m.content).join(' ').toLowerCase()
    if (bm.keywords.some((kw) => kw && text.includes(kw.toLowerCase()))) {
      triggered.push(bm)
    }
  }
  return triggered.sort((a, b) => b.priority - a.priority)
}
