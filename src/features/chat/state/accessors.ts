import type { ChatSession, ChatSettings } from './types'
import { lastUserMessageAt } from '@/lib/chat-activity'

export function getActiveSession(settings: ChatSettings) {
  return settings.sessions.find(session => session.id === settings.activeSessionId) || settings.sessions[0]
}

export function sortedSessions(sessions: ChatSession[]) {
  return [...sessions].sort((a, b) => Number(b.pinned) - Number(a.pinned) || lastUserMessageAt(b) - lastUserMessageAt(a))
}

export function bumpConfig(settings: ChatSettings): ChatSettings {
  return { ...settings, configUpdatedAt: Date.now() }
}
