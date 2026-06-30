/**
 * Chat store — zustand + localStorage persist + server sync.
 * Local-first: writes go to localStorage immediately, then background-sync to Postgres.
 * On mount (or tab focus), pulls latest from server and merges.
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
  synced?: boolean  // true once confirmed on server
}

export interface ChatSettings {
  systemPrompt: string
  contextLength: number
  model: string
  thinkingBudget: number
  promptCaching: boolean
}

const DEFAULT_SETTINGS: ChatSettings = {
  systemPrompt: '',
  contextLength: 30,
  model: 'claude-opus-4-5',
  thinkingBudget: 8000,
  promptCaching: true,
}

interface ChatStore {
  messages: ChatMessage[]
  settings: ChatSettings
  lastSyncAt: string | null  // ISO timestamp of last successful pull
  syncing: boolean

  addMessage: (m: ChatMessage) => void
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void
  clearMessages: () => void
  setSettings: (patch: Partial<ChatSettings>) => void
  resetSettings: () => void

  // Sync actions
  pushToServer: () => Promise<void>
  pullFromServer: () => Promise<void>
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      messages: [],
      settings: DEFAULT_SETTINGS,
      lastSyncAt: null,
      syncing: false,

      addMessage: (m) => {
        set((s) => ({ messages: [...s.messages, m] }))
        // Background push (fire and forget)
        setTimeout(() => get().pushToServer(), 500)
      },

      updateMessage: (id, patch) =>
        set((s) => ({
          messages: s.messages.map((msg) => (msg.id === id ? { ...msg, ...patch } : msg)),
        })),

      clearMessages: () => {
        set({ messages: [], lastSyncAt: null })
        // TODO: also clear server session if needed
      },

      setSettings: (patch) => {
        set((s) => ({ settings: { ...s.settings, ...patch } }))
        // Sync settings to server
        setTimeout(() => get().pushToServer(), 1000)
      },

      resetSettings: () => set({ settings: DEFAULT_SETTINGS }),

      pushToServer: async () => {
        const { messages, settings, syncing } = get()
        if (syncing) return
        set({ syncing: true })
        try {
          const unsynced = messages.filter((m) => !m.synced)
          if (unsynced.length === 0 && !settings) {
            set({ syncing: false })
            return
          }
          const res = await fetch('/api/chat/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user: 'fire',
              messages: unsynced.map((m) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                thinking: m.thinking,
                input_tokens: m.input_tokens,
                output_tokens: m.output_tokens,
                cache_read_tokens: m.cache_read_tokens,
                cache_creation_tokens: m.cache_creation_tokens,
                timestamp: m.timestamp,
              })),
              settings,
            }),
          })
          if (res.ok) {
            // Mark all as synced
            set((s) => ({
              syncing: false,
              messages: s.messages.map((m) => ({ ...m, synced: true })),
            }))
          } else {
            set({ syncing: false })
          }
        } catch {
          set({ syncing: false })
        }
      },

      pullFromServer: async () => {
        const { lastSyncAt, syncing } = get()
        if (syncing) return
        set({ syncing: true })
        try {
          const params = new URLSearchParams({ user: 'fire' })
          if (lastSyncAt) params.set('after', lastSyncAt)

          const res = await fetch(`/api/chat/sync?${params}`)
          if (!res.ok) { set({ syncing: false }); return }

          const data = await res.json()
          const serverMessages: ChatMessage[] = (data.messages || []).map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            thinking: m.thinking,
            timestamp: new Date(m.createdAt).getTime(),
            input_tokens: m.inputTokens,
            output_tokens: m.outputTokens,
            cache_read_tokens: m.cacheReadTokens,
            cache_creation_tokens: m.cacheCreationTokens,
            synced: true,
          }))

          if (serverMessages.length > 0) {
            set((s) => {
              const existingIds = new Set(s.messages.map((m) => m.id))
              const newOnes = serverMessages.filter((m) => !existingIds.has(m.id))
              const merged = [...s.messages, ...newOnes].sort((a, b) => a.timestamp - b.timestamp)
              return { messages: merged }
            })
          }

          // Merge server settings if we have none locally
          if (data.config) {
            const local = get().settings
            if (!local.systemPrompt && data.config.systemPrompt) {
              set({ settings: { ...local, ...data.config } })
            }
          }

          set({
            syncing: false,
            lastSyncAt: new Date().toISOString(),
          })
        } catch {
          set({ syncing: false })
        }
      },
    }),
    {
      name: 'starfire-chat',
      storage: createJSONStorage(() => localStorage),
      version: 2,
    },
  ),
)

// Token estimator
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 3.5)
}
