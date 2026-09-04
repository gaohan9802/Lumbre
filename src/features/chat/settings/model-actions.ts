import { DEFAULT_SETTINGS, makeChatId } from '@/features/chat/state/defaults'
import { bumpConfig, getActiveSession } from '@/features/chat/state/accessors'
import { normalizeProfile, normalizeSettings } from '@/features/chat/migrations/browser-state'
import type { ApiProfile, ChatMessage, ChatSettings, ProviderModel } from '@/features/chat/state/types'

type ChatState = { settings: ChatSettings; messages: ChatMessage[] }
type SetChatState = (updater: (state: ChatState) => Partial<ChatState> | ChatState) => void

export interface ModelSettingsActions {
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
}

const makeId = makeChatId

export function createModelSettingsActions(set: SetChatState): ModelSettingsActions {
  return {
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

    deleteModel: (profileId, modelId) => set((state) => {
      const settings = normalizeSettings(state.settings)
      const profiles = settings.apiProfiles.map((p) => {
        if (p.id !== profileId || p.models.length <= 1) return p
        const models = p.models.filter((m) => m.id !== modelId)
        if (models.length === p.models.length) return p
        const fallback = models.find((m) => m.enabled) || models[0]
        return { ...p, models, defaultModel: p.defaultModel === modelId ? fallback.id : p.defaultModel }
      })
      const active = profiles.find((p) => p.id === settings.activeProfileId) || profiles[0]
      const selectedStillExists = active.models.some((m) => m.id === settings.model)
      const model = selectedStillExists ? settings.model : (active.models.find((m) => m.enabled) || active.models[0]).id
      const nextSettings = bumpConfig(normalizeSettings({ ...settings, apiProfiles: profiles, model }))
      return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
    }),
  }
}
