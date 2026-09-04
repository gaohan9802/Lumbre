import type { ChatAppearance, ChatSettings, ProviderModel } from './types'

export const DEFAULT_ANTHROPIC_BASE = 'https://api.anthropic.com'
export const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1'
export const DEFAULT_PROFILE_ID = 'anthropic-default'

export function makeChatId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
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

const DEFAULT_ANTHROPIC_MODELS: ProviderModel[] = [
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', enabled: true },
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', enabled: false },
  { id: 'claude-3-5-haiku-20241022', name: 'Claude Haiku 3.5', enabled: false },
]

const defaultSessionId = makeChatId('session')
const now = Date.now()

export const DEFAULT_SETTINGS: ChatSettings = {
  systemPrompt: '',
  contextLength: 30,
  model: 'claude-sonnet-4-20250514',
  thinkingBudget: 8000,
  temperature: 1,
  streamEnabled: false,
  promptCaching: true,
  appearance: DEFAULT_APPEARANCE,
  activeProfileId: DEFAULT_PROFILE_ID,
  apiProfiles: [{
    id: DEFAULT_PROFILE_ID,
    name: 'Anthropic',
    provider: 'anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    models: DEFAULT_ANTHROPIC_MODELS,
    credentialConfigured: false,
  }],
  activeSessionId: defaultSessionId,
  sessions: [{ id: defaultSessionId, title: '新的对话', messages: [], pinned: false, createdAt: now, updatedAt: now }],
  tombstones: {},
  bookmarks: [],
  summaryTurnSize: 20,
  summaryInjectCount: 3,
  configUpdatedAt: 0,
}
