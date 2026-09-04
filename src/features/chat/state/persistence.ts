import type { ChatSettings } from './types'

export const CHAT_STORAGE_KEY = 'starfire-chat'
export const CHAT_STORAGE_VERSION = 11
export const CHAT_MIGRATION_BACKUP_KEY = 'starfire-chat-migration-backup-v11'

export const stripBase64Images = (value: string): string =>
  value
    .replace(/,"data:image\/[^\"]*"/g, '')
    .replace(/"data:image\/[^\"]*",/g, '')
    .replace(/"data:image\/[^\"]*"/g, '')

export const quotaSafeStorage = {
  getItem: (name: string): string | null => {
    try { return localStorage.getItem(name) } catch { return null }
  },
  setItem: (name: string, value: string): void => {
    try { localStorage.setItem(name, stripBase64Images(value)) } catch { /* server sync restores it */ }
  },
  removeItem: (name: string): void => {
    try { localStorage.removeItem(name) } catch { /* unavailable storage */ }
  },
}

export function partializeChatState(settings: ChatSettings) {
  return {
    settings: {
      ...settings,
      sessions: settings.sessions.map((session) => {
        const fullCount = session.partial ? (session.messageCount || session.messages.length) : session.messages.length
        const active = session.id === settings.activeSessionId
        if (!active) return { ...session, messages: [], summaries: [], stageSummaries: [], messageCount: fullCount, partial: fullCount > 0 }
        if (fullCount <= 50) return { ...session, messageCount: fullCount, partial: false }
        return { ...session, messages: session.messages.slice(-50), messageCount: fullCount, partial: true }
      }),
    },
  }
}

export function backupMigratedChatState(settings: ChatSettings, fromVersion: number) {
  if (typeof localStorage === 'undefined') return
  try {
    if (localStorage.getItem(CHAT_MIGRATION_BACKUP_KEY)) return
    localStorage.setItem(CHAT_MIGRATION_BACKUP_KEY, stripBase64Images(JSON.stringify({
      fromVersion,
      migratedAt: Date.now(),
      ...partializeChatState(settings),
    })))
  } catch { /* migration must still succeed when storage is full or unavailable */ }
}
