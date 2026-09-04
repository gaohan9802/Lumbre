import type { ChatSession, ChatSettings } from './types'

export function getActiveSession(settings: ChatSettings) {
  return settings.sessions.find(session => session.id === settings.activeSessionId) || settings.sessions[0]
}

export function sortedSessions(sessions: ChatSession[]) {
  return [...sessions].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
}

export function bumpConfig(settings: ChatSettings): ChatSettings {
  return { ...settings, configUpdatedAt: Date.now() }
}
