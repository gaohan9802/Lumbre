import { normalizeReplyMode } from '@/lib/chat-reply-mode'
import { DEFAULT_ANTHROPIC_BASE, DEFAULT_APPEARANCE, DEFAULT_OPENAI_BASE, DEFAULT_SETTINGS, makeChatId } from '@/features/chat/state/defaults'
import type {
  ApiProfile, ApiProvider, BubbleLayout, ChatMessage, ChatSettings, ChatSummary, ContentBlock,
  MessageVersion, StageSummary,
} from '@/features/chat/state/types'

const numOr = (value: unknown) => typeof value === 'number' && isFinite(value) ? value : undefined
const makeId = makeChatId

function safeText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return '[无法显示的旧消息]' }
}

function normalizeBubbleLayout(value: any): BubbleLayout | undefined {
  if (value?.version !== 2 || !Array.isArray(value.segments)) return undefined
  const segments = value.segments.filter((segment: any) =>
    Number.isInteger(segment?.blockIndex) && segment.blockIndex >= 0 &&
    Number.isInteger(segment?.start) && segment.start >= 0 &&
    Number.isInteger(segment?.end) && segment.end > segment.start &&
    ['text', 'code', 'list', 'quote', 'table'].includes(segment?.kind))
    .map((segment: any) => ({ blockIndex: segment.blockIndex, start: segment.start, end: segment.end, kind: segment.kind }))
  return segments.length ? { version: 2, segments } : undefined
}

function normalizeContentBlock(block: any): ContentBlock | null {
  if (!block || !['thinking', 'text', 'tool_call'].includes(block.type)) return null
  return {
    type: block.type,
    content: block.content == null ? undefined : safeText(block.content),
    name: block.name == null ? undefined : safeText(block.name),
    input: block.input && typeof block.input === 'object' ? block.input : undefined,
    result: block.result == null ? undefined : safeText(block.result),
  }
}

function normalizeVersion(version: any): MessageVersion {
  return {
    ...version,
    content: safeText(version?.content),
    thinking: version?.thinking == null ? undefined : safeText(version.thinking),
    timestamp: Number(version?.timestamp) || Date.now(),
    tool_calls: Array.isArray(version?.tool_calls) ? version.tool_calls.filter(Boolean).map((call: any) => ({
      name: safeText(call?.name),
      input: call?.input && typeof call.input === 'object' ? call.input : {},
      result: safeText(call?.result),
    })) : undefined,
    sharedCard: version?.sharedCard && typeof version.sharedCard === 'object' ? version.sharedCard : undefined,
    content_blocks: Array.isArray(version?.content_blocks)
      ? version.content_blocks.map(normalizeContentBlock).filter(Boolean) as ContentBlock[]
      : undefined,
    bubbleLayout: normalizeBubbleLayout(version?.bubbleLayout),
  }
}

function normalizeMessage(message: any): ChatMessage | null {
  if (!message || !['user', 'assistant'].includes(message.role)) return null
  const blocksValid = !message.content_blocks || (Array.isArray(message.content_blocks) && message.content_blocks.every((block: any) =>
    block && ['thinking', 'text', 'tool_call'].includes(block.type) &&
    (block.content == null || typeof block.content === 'string') &&
    (block.name == null || typeof block.name === 'string') &&
    (block.result == null || typeof block.result === 'string')))
  const versionsValid = !message.versions || (Array.isArray(message.versions) && message.versions.every((version: any) =>
    version && typeof version.content === 'string' && (version.thinking == null || typeof version.thinking === 'string') &&
    (!version.bubbleLayout || (Array.isArray(version.bubbleLayout.segments) && normalizeBubbleLayout(version.bubbleLayout)?.segments.length === version.bubbleLayout.segments.length))))
  const layoutValid = !message.bubbleLayout || (Array.isArray(message.bubbleLayout.segments) && normalizeBubbleLayout(message.bubbleLayout)?.segments.length === message.bubbleLayout.segments.length)
  const imagesValid = !message.images || (Array.isArray(message.images) && message.images.every((image: any) => typeof image === 'string'))
  // Keep object identity on the normal path; this runs for every store update.
  if (typeof message.id === 'string' && typeof message.content === 'string' &&
      (message.thinking == null || typeof message.thinking === 'string') &&
      blocksValid && versionsValid && layoutValid && imagesValid) return message as ChatMessage
  const normalized = normalizeVersion(message)
  const versions = Array.isArray(message.versions) ? message.versions.map(normalizeVersion) : undefined
  return {
    ...message,
    ...normalized,
    id: safeText(message.id) || makeId('message'),
    role: message.role,
    images: Array.isArray(message.images) ? message.images.filter((image: any) => typeof image === 'string') : undefined,
    sharedCard: message.sharedCard && typeof message.sharedCard === 'object' ? message.sharedCard : undefined,
    versions,
    versionIndex: versions?.length ? Math.max(0, Math.min(Number(message.versionIndex) || 0, versions.length - 1)) : undefined,
  }
}

export function normalizeProfile(profile: any): ApiProfile {
  const provider: ApiProvider = profile?.provider || 'anthropic'
  const defaultModel = profile?.defaultModel || (provider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o')
  const models = Array.isArray(profile?.models) && profile.models.length
    ? profile.models.map((model: any) => ({
        id: model.id || model.name,
        name: model.name,
        ownedBy: model.ownedBy || model.owned_by,
        created: model.created,
        enabled: model.enabled !== false,
        inputPrice: numOr(model.inputPrice),
        outputPrice: numOr(model.outputPrice),
        cachePrice: numOr(model.cachePrice),
      })).filter((model: any) => model.id)
    : [{ id: defaultModel, name: defaultModel, enabled: true }]
  if (!models.some((model: any) => model.id === defaultModel)) models.unshift({ id: defaultModel, name: defaultModel, enabled: true })
  return {
    id: profile?.id || makeId('provider'),
    name: profile?.name || 'New API',
    provider,
    defaultModel,
    models,
    lastFetchedAt: profile?.lastFetchedAt,
    credentialConfigured: profile?.credentialConfigured === true,
    upstreamOrigin: typeof profile?.upstreamOrigin === 'string' ? profile.upstreamOrigin : undefined,
  }
}

type LegacyCredential = { id: string; provider: ApiProvider; baseUrl: string; apiKey: string }
let pendingLegacyCredentials: LegacyCredential[] = []

export function captureLegacyCredentials(profiles: unknown) {
  if (!Array.isArray(profiles)) return
  const byId = new Map(pendingLegacyCredentials.map(profile => [profile.id, profile]))
  for (const profile of profiles as any[]) {
    if (!profile?.id || !profile?.apiKey) continue
    byId.set(String(profile.id), {
      id: String(profile.id),
      provider: profile.provider === 'openai-compatible' ? 'openai-compatible' : 'anthropic',
      baseUrl: String(profile.baseUrl || (profile.provider === 'openai-compatible' ? DEFAULT_OPENAI_BASE : DEFAULT_ANTHROPIC_BASE)),
      apiKey: String(profile.apiKey),
    })
  }
  pendingLegacyCredentials = Array.from(byId.values())
}

export function getPendingLegacyModelCredentials(): LegacyCredential[] {
  return pendingLegacyCredentials.map(profile => ({ ...profile }))
}

export function completeLegacyModelCredentialMigration(ids: string[]) {
  const done = new Set(ids)
  pendingLegacyCredentials = pendingLegacyCredentials.filter(profile => !done.has(profile.id))
}

export function normalizeSettings(settings: any): ChatSettings {
  const oldMessages = Array.isArray(settings?.messages) ? settings.messages : []
  const profiles = Array.isArray(settings?.apiProfiles) && settings.apiProfiles.length
    ? settings.apiProfiles.map(normalizeProfile)
    : DEFAULT_SETTINGS.apiProfiles
  const activeProfileId = profiles.some((profile: ApiProfile) => profile.id === settings?.activeProfileId)
    ? settings.activeProfileId
    : profiles[0].id
  const activeProfile = profiles.find((profile: ApiProfile) => profile.id === activeProfileId) || profiles[0]

  const sessions = Array.isArray(settings?.sessions) && settings.sessions.length
    ? settings.sessions.map((session: any) => ({
        id: session.id || makeId('session'),
        conversationMode: normalizeReplyMode(session.conversationMode),
        conversationModeUpdatedAt: Number.isFinite(session.conversationModeUpdatedAt) ? session.conversationModeUpdatedAt : 0,
        title: session.title || '新的对话',
        messages: Array.isArray(session.messages) ? session.messages.map(normalizeMessage).filter(Boolean) as ChatMessage[] : [],
        pinned: !!session.pinned,
        createdAt: session.createdAt || Date.now(),
        updatedAt: session.updatedAt || session.createdAt || Date.now(),
        partial: !!session.partial,
        messageCount: Math.max(Number(session.messageCount) || 0, Array.isArray(session.messages) ? session.messages.length : 0),
        summaries: Array.isArray(session.summaries) ? session.summaries.map((item: any) => ({
          id: item.id || makeId('sum'), sessionId: session.id, startAt: item.startAt || item.createdAt || Date.now(),
          endAt: item.endAt || item.createdAt || Date.now(), createdAt: item.createdAt || Date.now(),
          turnCount: item.turnCount || 0, messageCount: item.messageCount,
          sourceMessageIds: item.sourceMessageIds, coveredUntilMessageId: item.coveredUntilMessageId || '',
          eventSummary: String(item.eventSummary || item.overview || item.content || '').trim(), locked: !!item.locked,
          needsCorrection: !!item.needsCorrection, editedAt: item.editedAt,
        })).filter((item: ChatSummary) => item.eventSummary) : [],
        summaryRevision: Math.max(0, Number(session.summaryRevision) || 0),
        stageSummaries: Array.isArray(session.stageSummaries) ? session.stageSummaries.map((item: any) => ({
          id: item.id || makeId('stage'), sessionId: session.id, createdAt: item.createdAt || Date.now(),
          startAt: item.startAt || item.createdAt || Date.now(), endAt: item.endAt || item.createdAt || Date.now(),
          sourceSummaryIds: Array.isArray(item.sourceSummaryIds) ? item.sourceSummaryIds : [],
          title: String(item.title || '阶段摘要').trim(), content: String(item.content || item.overview || '').trim(),
        })).filter((item: StageSummary) => item.content) : [],
        summaryConfig: {
          autoEnabled: session.summaryConfig?.autoEnabled !== false,
          turnSize: [20, 30, 40].includes(session.summaryConfig?.turnSize) ? session.summaryConfig.turnSize : ([20, 30, 40].includes(settings?.summaryTurnSize) ? settings.summaryTurnSize : 20),
          injectCount: [3, 4, 5, 6, 7, 8, 9, 10].includes(session.summaryConfig?.injectCount) ? session.summaryConfig.injectCount : ([3, 4, 5, 6, 7, 8, 9, 10].includes(settings?.summaryInjectCount) ? settings.summaryInjectCount : 3),
          profileId: session.summaryConfig?.profileId, modelId: session.summaryConfig?.modelId, modeVersion: 2,
          anchorMessageId: session.summaryConfig?.modeVersion === 2 ? session.summaryConfig?.anchorMessageId : (Array.isArray(session.messages) ? session.messages.at(-1)?.id : undefined),
          anchorTimestamp: session.summaryConfig?.modeVersion === 2 ? session.summaryConfig?.anchorTimestamp : (Array.isArray(session.messages) ? session.messages.at(-1)?.timestamp : undefined),
        },
      }))
    : [{ ...DEFAULT_SETTINGS.sessions[0], messages: oldMessages.map(normalizeMessage).filter(Boolean) as ChatMessage[] }]

  const activeSessionId = sessions.some((session: any) => session.id === settings?.activeSessionId)
    ? settings.activeSessionId
    : sessions[0].id

  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    apiProfiles: profiles,
    activeProfileId,
    model: settings?.model || activeProfile?.defaultModel || 'claude-sonnet-4-20250514',
    temperature: typeof settings?.temperature === 'number' ? settings.temperature : 1,
    streamEnabled: !!settings?.streamEnabled,
    appearance: { ...DEFAULT_APPEARANCE, ...(settings?.appearance || {}) },
    sessions,
    activeSessionId,
    tombstones: settings?.tombstones && typeof settings.tombstones === 'object' ? settings.tombstones : {},
    bookmarks: Array.isArray(settings?.bookmarks) ? settings.bookmarks : [],
    summaryTurnSize: [20, 30, 40].includes(settings?.summaryTurnSize) ? settings.summaryTurnSize : 20,
    summaryInjectCount: [3, 4, 5, 6, 7, 8, 9, 10].includes(settings?.summaryInjectCount) ? settings.summaryInjectCount : 3,
    configUpdatedAt: typeof settings?.configUpdatedAt === 'number' ? settings.configUpdatedAt : 0,
  }
}
