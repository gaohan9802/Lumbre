/**
 * Chat store — local-first chat OS.
 * Sessions, provider metadata, model lists, bookmarks and appearance live in
 * localStorage and sync across devices. Provider credentials never do: API
 * keys and upstream URLs live only in the server-side model credential store.
 */
import { create } from 'zustand'
import type { SharedCard } from '@/lib/share'
import { persist, createJSONStorage } from 'zustand/middleware'

/** A content block in a message — renders inline in order */
export interface ContentBlock {
  type: 'thinking' | 'text' | 'tool_call'
  content?: string       // for text/thinking
  name?: string          // for tool_call
  input?: Record<string, any>  // for tool_call
  result?: string        // for tool_call
}

export interface MessageVersion {
  content: string
  thinking?: string
  timestamp: number
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_creation_tokens?: number
  tool_calls?: { name: string; input: Record<string, any>; result: string }[]
  content_blocks?: ContentBlock[]  // ordered inline blocks (thinking/text/tool interleaved)
  sharedCard?: SharedCard
  providerId?: string
  modelId?: string
}

export interface ChatMessage extends MessageVersion {
  id: string
  role: 'user' | 'assistant'
  images?: string[]
  sharedCard?: SharedCard
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
  defaultModel: string
  models: ProviderModel[]
  lastFetchedAt?: number
  credentialConfigured?: boolean
  upstreamOrigin?: string
}

export interface ChatSummary {
  id: string
  sessionId: string
  startAt: number
  endAt: number
  createdAt: number
  turnCount: number
  messageCount?: number
  sourceMessageIds?: string[]
  coveredUntilMessageId: string
  /** The only user-facing summary field. */
  eventSummary: string
  locked?: boolean
  needsCorrection?: boolean
  editedAt?: number
}

export interface StageSummary {
  id: string
  sessionId: string
  createdAt: number
  startAt: number
  endAt: number
  sourceSummaryIds: string[]
  title: string
  content: string
}

export interface SessionSummaryConfig {
  autoEnabled: boolean
  turnSize: 20 | 30 | 40
  injectCount: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  profileId?: string
  modelId?: string
  /** v2 seals all pre-upgrade history and only summarizes newer messages. */
  modeVersion?: 2
  anchorMessageId?: string
  anchorTimestamp?: number
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  pinned: boolean
  createdAt: number
  updatedAt: number
  /** Local persisted tail; full history is restored lazily from /api/sync. */
  partial?: boolean
  messageCount?: number
  summaries?: ChatSummary[]
  stageSummaries?: StageSummary[]
  summaryRevision?: number
  summaryConfig?: SessionSummaryConfig
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
  summaryTurnSize: 20 | 30 | 40
  summaryInjectCount: 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
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
      defaultModel: 'claude-sonnet-4-20250514',
      models: DEFAULT_ANTHROPIC_MODELS,
      credentialConfigured: false,
    },
  ],
  activeSessionId: DEFAULT_SESSION_ID,
  sessions: [
    { id: DEFAULT_SESSION_ID, title: '新的对话', messages: [], pinned: false, createdAt: NOW, updatedAt: NOW },
  ],
  tombstones: {},
  bookmarks: [],
  summaryTurnSize: 20,
  summaryInjectCount: 3,
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
  ensureSession: (id: string, title: string, activate?: boolean) => string
  setActiveSession: (id: string) => void
  deleteMessage: (id: string) => void
  truncateFrom: (id: string) => void
  branchFromMessage: (id: string) => string
  addMessageVersion: (id: string, v: MessageVersion) => void
  switchMessageVersion: (id: string, index: number) => void
  deleteMessageVersion: (id: string, index: number) => void
  mergeRemote: (sessions: ChatSession[], tombstones: Record<string, number>) => void
  prependSessionMessages: (sessionId: string, messages: ChatMessage[], total: number) => void
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
  deleteModel: (profileId: string, modelId: string) => void

  continueSession: (tailCount?: number) => string

  addBookmark: (b: Omit<Bookmark, 'id'>) => void
  updateBookmark: (id: string, patch: Partial<Bookmark>) => void
  deleteBookmark: (id: string) => void
  addSummary: (sessionId: string, summary: ChatSummary) => void
  updateSummary: (sessionId: string, id: string, patch: Partial<ChatSummary>) => void
  addStageSummary: (sessionId: string, summary: StageSummary) => void
  deleteSummary: (sessionId: string, id: string) => void
  updateSessionSummaryConfig: (sessionId: string, patch: Partial<SessionSummaryConfig>) => void
}

const makeId = genId

// A blank session (no messages, not pinned, default/empty title) is pure local
// scratch space; it must never be synced or it accumulates across boots/devices.
export function isBlankSession(s: any) {
  return (s?.messages?.length || 0) === 0 && !s?.pinned && (!s?.title || s.title === '新的对话')
}

function summaryCount(session: any) {
  return (Array.isArray(session?.summaries) ? session.summaries.length : 0)
    + (Array.isArray(session?.stageSummaries) ? session.stageSummaries.length : 0)
}

export function mergeSummaryLayer(existing: any, incoming: any) {
  const existingRevision = Math.max(0, Number(existing?.summaryRevision) || 0)
  const incomingRevision = Math.max(0, Number(incoming?.summaryRevision) || 0)
  const source = incomingRevision > existingRevision
    ? incoming
    : existingRevision > incomingRevision
      ? existing
      : summaryCount(incoming) >= summaryCount(existing) ? incoming : existing

  return {
    summaries: Array.isArray(source?.summaries) ? source.summaries : [],
    stageSummaries: Array.isArray(source?.stageSummaries) ? source.stageSummaries : [],
    summaryConfig: incoming?.summaryConfig || existing?.summaryConfig,
    summaryRevision: Math.max(existingRevision, incomingRevision),
  }
}

function preserveMergedSummary(base: any, existing: any, incoming: any) {
  const summaryLayer = mergeSummaryLayer(existing, incoming)
  const baseRevision = Math.max(0, Number(base?.summaryRevision) || 0)
  const needsRepublish = summaryLayer.summaryRevision > baseRevision
    || (summaryLayer.summaryRevision === baseRevision && summaryCount(summaryLayer) > summaryCount(base))

  return {
    ...base,
    ...summaryLayer,
    // When the newest message layer did not contain the richest summary layer,
    // mark the combined session as a new local revision. The next sync then
    // repairs the durable server copy instead of preserving the summary only in
    // this browser's localStorage.
    updatedAt: needsRepublish
      ? Math.max(Date.now(), Number(existing?.updatedAt) || 0, Number(incoming?.updatedAt) || 0) + 1
      : base.updatedAt,
  }
}

// When two sessions share an id, the more recent edit wins so deletions and
// edits actually propagate (deleting a message lowers the count, so a naive
// "more messages wins" would resurrect it). The only guard is that a blank
// scratch session (0 msgs, default title) must never clobber a real one.
export function mergeChatSessionsForSync(a: any, b: any) {
  if (a?.partial && b?.partial) {
    const newer = (b.updatedAt || 0) > (a.updatedAt || 0) ? b : a
    const byId = new Map<string, ChatMessage>()
    for (const message of [...(a.messages || []), ...(b.messages || [])]) {
      if (message?.id) byId.set(message.id, message)
    }
    const messages = Array.from(byId.values()).sort((x, y) => (x.timestamp || 0) - (y.timestamp || 0))
    const messageCount = Math.max(Number(a.messageCount) || 0, Number(b.messageCount) || 0, messages.length)
    return preserveMergedSummary({ ...a, ...newer, messages, messageCount, partial: messages.length < messageCount }, a, b)
  }
  // A server session always beats a locally persisted tail, even when their
  // timestamps are equal. This is what lets startup paint the latest 100
  // messages immediately and hydrate the other 3900+ in the background.
  if (a?.partial && !b?.partial) {
    if ((a.updatedAt || 0) <= (b.updatedAt || 0)) return preserveMergedSummary(b, a, b)
    const ids = new Set((b.messages || []).map((m: any) => m.id))
    const extras = (a.messages || []).filter((m: any) => !ids.has(m.id))
    return preserveMergedSummary({ ...b, ...a, partial: false, messages: [...(b.messages || []), ...extras], messageCount: (b.messages || []).length + extras.length }, a, b)
  }
  if (b?.partial && !a?.partial) {
    if ((b.updatedAt || 0) <= (a.updatedAt || 0)) return preserveMergedSummary(a, a, b)
    const ids = new Set((a.messages || []).map((m: any) => m.id))
    const extras = (b.messages || []).filter((m: any) => !ids.has(m.id))
    return preserveMergedSummary({ ...a, ...b, partial: false, messages: [...(a.messages || []), ...extras], messageCount: (a.messages || []).length + extras.length }, a, b)
  }
  const aBlank = isBlankSession(a)
  const bBlank = isBlankSession(b)
  if (aBlank && !bBlank) return b
  if (bBlank && !aBlank) return a
  const newer = (b?.updatedAt || 0) > (a?.updatedAt || 0) ? b : a
  return preserveMergedSummary(newer, a, b)
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
    sharedCard: m.sharedCard,
  }
}

function safeText(value: any): string {
  if (typeof value === 'string') return value
  if (value == null) return ''
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try { return JSON.stringify(value) } catch { return '[无法显示的旧消息]' }
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
    version && typeof version.content === 'string' && (version.thinking == null || typeof version.thinking === 'string')))
  const imagesValid = !message.images || (Array.isArray(message.images) && message.images.every((image: any) => typeof image === 'string'))
  // Preserve object identity for the normal path. normalizeSettings runs for
  // every store mutation; cloning thousands of valid messages here would cause
  // exactly the memory churn and WebKit tab kills this guard is meant to stop.
  if (typeof message.id === 'string' && typeof message.content === 'string' &&
      (message.thinking == null || typeof message.thinking === 'string') &&
      blocksValid && versionsValid && imagesValid) return message as ChatMessage
  const normalized = normalizeVersion(message)
  const versions = Array.isArray(message.versions) ? message.versions.map(normalizeVersion) : undefined
  return {
    ...message,
    ...normalized,
    id: safeText(message.id) || genId('message'),
    role: message.role,
    images: Array.isArray(message.images) ? message.images.filter((image: any) => typeof image === 'string') : undefined,
    sharedCard: message.sharedCard && typeof message.sharedCard === 'object' ? message.sharedCard : undefined,
    versions,
    versionIndex: versions?.length ? Math.max(0, Math.min(Number(message.versionIndex) || 0, versions.length - 1)) : undefined,
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
    defaultModel,
    models,
    lastFetchedAt: p?.lastFetchedAt,
    credentialConfigured: p?.credentialConfigured === true,
    upstreamOrigin: typeof p?.upstreamOrigin === 'string' ? p.upstreamOrigin : undefined,
  }
}

type LegacyCredential = { id: string; provider: ApiProvider; baseUrl: string; apiKey: string }
let pendingLegacyCredentials: LegacyCredential[] = []

function captureLegacyCredentials(profiles: unknown) {
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
        messages: Array.isArray(s.messages) ? s.messages.map(normalizeMessage).filter(Boolean) as ChatMessage[] : [],
        pinned: !!s.pinned,
        createdAt: s.createdAt || Date.now(),
        updatedAt: s.updatedAt || s.createdAt || Date.now(),
        partial: !!s.partial,
        messageCount: Math.max(Number(s.messageCount) || 0, Array.isArray(s.messages) ? s.messages.length : 0),
        summaries: Array.isArray(s.summaries) ? s.summaries.map((item: any) => ({
          id: item.id || makeId('sum'), sessionId: s.id, startAt: item.startAt || item.createdAt || Date.now(),
          endAt: item.endAt || item.createdAt || Date.now(), createdAt: item.createdAt || Date.now(),
          turnCount: item.turnCount || 0, messageCount: item.messageCount,
          sourceMessageIds: item.sourceMessageIds, coveredUntilMessageId: item.coveredUntilMessageId || '',
          eventSummary: String(item.eventSummary || item.overview || item.content || '').trim(), locked: !!item.locked, needsCorrection: !!item.needsCorrection, editedAt: item.editedAt,
        })).filter((item: ChatSummary) => item.eventSummary) : [],
        summaryRevision: Math.max(0, Number(s.summaryRevision) || 0),
        stageSummaries: Array.isArray(s.stageSummaries) ? s.stageSummaries.map((item: any) => ({
          id: item.id || makeId('stage'), sessionId: s.id, createdAt: item.createdAt || Date.now(),
          startAt: item.startAt || item.createdAt || Date.now(), endAt: item.endAt || item.createdAt || Date.now(),
          sourceSummaryIds: Array.isArray(item.sourceSummaryIds) ? item.sourceSummaryIds : [],
          title: String(item.title || '阶段摘要').trim(), content: String(item.content || item.overview || '').trim(),
        })).filter((item: StageSummary) => item.content) : [],
        summaryConfig: {
          autoEnabled: s.summaryConfig?.autoEnabled !== false,
          turnSize: [20, 30, 40].includes(s.summaryConfig?.turnSize) ? s.summaryConfig.turnSize : ([20, 30, 40].includes(settings?.summaryTurnSize) ? settings.summaryTurnSize : 20),
          injectCount: [3, 4, 5, 6, 7, 8, 9, 10].includes(s.summaryConfig?.injectCount) ? s.summaryConfig.injectCount : ([3, 4, 5, 6, 7, 8, 9, 10].includes(settings?.summaryInjectCount) ? settings.summaryInjectCount : 3),
          profileId: s.summaryConfig?.profileId, modelId: s.summaryConfig?.modelId, modeVersion: 2,
          // One-time v2 migration: everything already present is sealed history.
          anchorMessageId: s.summaryConfig?.modeVersion === 2 ? s.summaryConfig?.anchorMessageId : (Array.isArray(s.messages) ? s.messages[s.messages.length - 1]?.id : undefined),
          anchorTimestamp: s.summaryConfig?.modeVersion === 2 ? s.summaryConfig?.anchorTimestamp : (Array.isArray(s.messages) ? s.messages[s.messages.length - 1]?.timestamp : undefined),
        },
      }))
    : [{ ...DEFAULT_SETTINGS.sessions[0], messages: oldMessages.map(normalizeMessage).filter(Boolean) as ChatMessage[] }]

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
    summaryTurnSize: [20, 30, 40].includes(settings?.summaryTurnSize) ? settings.summaryTurnSize : 20,
    summaryInjectCount: [3, 4, 5, 6, 7, 8, 9, 10].includes(settings?.summaryInjectCount) ? settings.summaryInjectCount : 3,
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

/* ── quota-safe localStorage ──
 * Mobile WebKit caps localStorage at ~5MB. A long conversation (hundreds of
 * messages + base64 images) overflows it, and a raw setItem then throws
 * QuotaExceededError synchronously — which on send would propagate out of
 * addMessage() and abort the whole flow BEFORE the API call, leaving the
 * message stuck in the box with no reply and no error. The server sync
 * (/api/sync) is the real source of truth, so persistence is best-effort:
 * never throw, and when the quota is hit, drop the heavy base64 images from
 * the persisted copy and retry so at least the text survives a reload. */
// Remove only heavy base64 data-URL images from the persisted string, keeping
// lightweight /api/photos/raw/<id> URL references intact (so images still show
// on a cold start before the server pull). Base64 only appears as a fallback
// when the photo-wall write failed; the server sync holds the real copy either
// way, so dropping it locally is safe and never touches in-memory state.
const stripBase64Images = (value: string): string =>
  value
    .replace(/,"data:image\/[^"]*"/g, '')
    .replace(/"data:image\/[^"]*",/g, '')
    .replace(/"data:image\/[^"]*"/g, '')

const quotaSafeStorage = {
  getItem: (name: string): string | null => {
    try { return localStorage.getItem(name) } catch { return null }
  },
  setItem: (name: string, value: string): void => {
    // Always strip base64 images before writing so a long conversation with
    // pasted images can never overflow the ~5MB mobile localStorage quota.
    const slim = stripBase64Images(value)
    try {
      localStorage.setItem(name, slim)
    } catch {
      // Still too big even without images — give up silently; server sync
      // (/api/sync) is the source of truth and restores on next load.
    }
  },
  removeItem: (name: string): void => {
    try { localStorage.removeItem(name) } catch { /* ignore */ }
  },
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
          return { ...s, title: shouldAutoTitle ? sessionTitleFromMessage(m.content) : s.title, messages: nextMessages, messageCount: Math.max(s.messageCount || 0, nextMessages.length), updatedAt: Date.now() }
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
        const sessions = settings.sessions.map((s) => s.id === settings.activeSessionId ? { ...s, messages: [], summaries: [], stageSummaries: [], summaryRevision: (s.summaryRevision || 0) + 1, messageCount: 0, updatedAt: Date.now() } : s)
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

      ensureSession: (id, title, activate = true) => {
        const now = Date.now()
        set((state) => {
          const settings = normalizeSettings(state.settings)
          const existing = settings.sessions.find((session) => session.id === id)
          const sessions = existing ? settings.sessions : [{ id, title, messages: [], pinned: false, createdAt: now, updatedAt: now }, ...settings.sessions]
          const nextSettings = { ...settings, sessions, activeSessionId: activate ? id : settings.activeSessionId }
          return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
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
        const nextSettings = normalizeSettings({ ...settings, sessions, activeSessionId, tombstones })
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      deleteMessage: (id) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const sessions = settings.sessions.map((s) => {
          if (s.id !== settings.activeSessionId) return s
          const deletedIndex = s.messages.findIndex((m) => m.id === id)
          const messages = s.messages.filter((m) => m.id !== id)
          const summaries = deletedIndex < 0 ? (s.summaries || []) : (s.summaries || []).filter((summary) => {
            if (summary.locked) return true
            if (summary.sourceMessageIds?.length) return !summary.sourceMessageIds.includes(id)
            return !(s.messages[deletedIndex].timestamp >= summary.startAt && s.messages[deletedIndex].timestamp <= summary.endAt)
          })
          const summaryIds = new Set(summaries.map(item => item.id))
          const stageSummaries = (s.stageSummaries || []).filter(stage => stage.sourceSummaryIds.every(id => summaryIds.has(id)))
          return { ...s, messages, summaries, stageSummaries, summaryRevision: summaries.length !== (s.summaries || []).length ? (s.summaryRevision || 0) + 1 : (s.summaryRevision || 0), messageCount: messages.length, updatedAt: Date.now() }
        })
        const nextSettings = { ...settings, sessions }
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      truncateFrom: (id) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const sessions = settings.sessions.map((s) => {
          if (s.id !== settings.activeSessionId) return s
          const idx = s.messages.findIndex((m) => m.id === id)
          if (idx < 0) return s
          const messages = s.messages.slice(0, idx)
          const keptIds = new Set(messages.map((m) => m.id))
          const summaries = (s.summaries || []).filter((summary) => summary.locked || (summary.sourceMessageIds?.length
            ? summary.sourceMessageIds.every((messageId) => keptIds.has(messageId))
            : keptIds.has(summary.coveredUntilMessageId)))
          const summaryIds = new Set(summaries.map(item => item.id))
          const stageSummaries = (s.stageSummaries || []).filter(stage => stage.sourceSummaryIds.every(id => summaryIds.has(id)))
          return { ...s, messages, summaries, stageSummaries, summaryRevision: summaries.length !== (s.summaries || []).length ? (s.summaryRevision || 0) + 1 : (s.summaryRevision || 0), messageCount: messages.length, updatedAt: Date.now() }
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
          const branchMessageIds = new Set(active.messages.slice(0, idx + 1).map((m) => m.id))
          const branch: ChatSession = {
            id: newId,
            title: `${active.title} · 分支`,
            messages: active.messages.slice(0, idx + 1).map((m) => ({ ...m })),
            summaries: (active.summaries || []).filter((summary) => summary.sourceMessageIds?.length
              ? summary.sourceMessageIds.every((messageId) => branchMessageIds.has(messageId))
              : branchMessageIds.has(summary.coveredUntilMessageId)).map((summary) => ({ ...summary, id: makeId('sum'), sessionId: newId })),
            stageSummaries: [],
            summaryConfig: { ...(active.summaryConfig || { autoEnabled: true, turnSize: settings.summaryTurnSize, injectCount: settings.summaryInjectCount }), modeVersion: 2, anchorMessageId: active.messages[idx]?.id, anchorTimestamp: active.messages[idx]?.timestamp },
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
          map.set(rs.id, cur ? mergeChatSessionsForSync(cur, rs) : rs)
        }
        let sessions = Array.from(map.values()).filter((s) => !(tombstones[s.id] && tombstones[s.id] >= (s.updatedAt || 0)))
        // drop stale blank sessions (keep the active one so a freshly created empty chat survives)
        const keepId = settings.activeSessionId
        sessions = sessions.filter((s) => s.id === keepId || !isBlankSession(s))
        if (!sessions.length) sessions = [{ id: makeId('session'), title: '新的对话', messages: [], pinned: false, createdAt: Date.now(), updatedAt: Date.now() }]
        const activeSessionId = sessions.some((s) => s.id === settings.activeSessionId) ? settings.activeSessionId : sortedSessions(sessions)[0].id
        const nextSettings = normalizeSettings({ ...settings, sessions, activeSessionId, tombstones })
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      prependSessionMessages: (sessionId, incoming, total) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const sessions = settings.sessions.map((session) => {
          if (session.id !== sessionId) return session
          const byId = new Map<string, ChatMessage>()
          for (const message of [...incoming, ...session.messages]) {
            if (message?.id) byId.set(message.id, message)
          }
          const messages = Array.from(byId.values()).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
          const messageCount = Math.max(Number(total) || 0, messages.length)
          return { ...session, messages, messageCount, partial: messages.length < messageCount }
        })
        const nextSettings = { ...settings, sessions }
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

      continueSession: (tailCount = 50) => {
        const id = makeId('session')
        const now = Date.now()
        set((state) => {
          const settings = normalizeSettings(state.settings)
          const active = getActiveSession(settings)
          const tail = active.messages.slice(-Math.max(1, tailCount)).map((m) => ({
            ...m,
            images: m.images ? [...m.images] : undefined,
            versions: m.versions ? m.versions.map((v) => ({ ...v })) : undefined,
            tool_calls: m.tool_calls ? m.tool_calls.map((tc) => ({ ...tc, input: { ...tc.input } })) : undefined,
            content_blocks: m.content_blocks ? m.content_blocks.map((block) => ({ ...block, input: block.input ? { ...block.input } : undefined })) : undefined,
          }))
          const nextSession: ChatSession = {
            id,
            title: `${active.title || '对话'} · 续窗`,
            messages: tail,
            summaries: (active.summaries || []).slice(-(active.summaryConfig?.injectCount || settings.summaryInjectCount)).map((summary, index, copied) => ({ ...summary, id: makeId('sum'), sessionId: id, coveredUntilMessageId: index === copied.length - 1 ? (tail[tail.length - 1]?.id || summary.coveredUntilMessageId) : summary.coveredUntilMessageId })),
            stageSummaries: [],
            summaryConfig: { ...(active.summaryConfig || { autoEnabled: true, turnSize: settings.summaryTurnSize, injectCount: settings.summaryInjectCount }), modeVersion: 2, anchorMessageId: tail[tail.length - 1]?.id, anchorTimestamp: tail[tail.length - 1]?.timestamp },
            pinned: false,
            createdAt: now,
            updatedAt: now,
            messageCount: tail.length,
          }
          const nextSettings = { ...settings, sessions: [nextSession, ...settings.sessions], activeSessionId: id }
          return { settings: nextSettings, messages: tail }
        })
        return id
      },

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

      addSummary: (sessionId, summary) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const sessions = settings.sessions.map((session) => session.id === sessionId
          ? { ...session, summaries: [...(session.summaries || []), summary], summaryRevision: (session.summaryRevision || 0) + 1, updatedAt: Date.now() } : session)
        const nextSettings = { ...settings, sessions }
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      updateSummary: (sessionId, id, patch) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const contentChanged = Object.prototype.hasOwnProperty.call(patch, 'eventSummary')
        const sessions = settings.sessions.map((session) => {
          if (session.id !== sessionId) return session
          const current = (session.summaries || []).find(item => item.id === id)
          if (!current) return session
          // A locked summary is immutable. The only permitted change is unlocking it.
          if (current.locked && !(Object.keys(patch).length === 1 && patch.locked === false)) return session
          return { ...session, summaries: (session.summaries || []).map((item) => item.id === id ? { ...item, ...patch } : item),
            stageSummaries: contentChanged ? (session.stageSummaries || []).filter(stage => !stage.sourceSummaryIds.includes(id)) : (session.stageSummaries || []), summaryRevision: (session.summaryRevision || 0) + 1, updatedAt: Date.now() }
        })
        const nextSettings = { ...settings, sessions }
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      addStageSummary: (sessionId, summary) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const sessions = settings.sessions.map((session) => session.id === sessionId
          ? { ...session, stageSummaries: [...(session.stageSummaries || []), summary], summaryRevision: (session.summaryRevision || 0) + 1, updatedAt: Date.now() } : session)
        const nextSettings = { ...settings, sessions }
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      deleteSummary: (sessionId, id) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const sessions = settings.sessions.map((session) => {
          if (session.id !== sessionId) return session
          const target = (session.summaries || []).find(item => item.id === id)
          if (!target || target.locked) return session
          return { ...session, summaries: (session.summaries || []).filter((item) => item.id !== id), stageSummaries: (session.stageSummaries || []).filter(stage => !stage.sourceSummaryIds.includes(id)), summaryRevision: (session.summaryRevision || 0) + 1, updatedAt: Date.now() }
        })
        const nextSettings = { ...settings, sessions }
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
      }),

      updateSessionSummaryConfig: (sessionId, patch) => set((state) => {
        const settings = normalizeSettings(state.settings)
        const sessions = settings.sessions.map((session) => {
          if (session.id !== sessionId) return session
          const base = session.summaryConfig || { autoEnabled: true, turnSize: settings.summaryTurnSize, injectCount: settings.summaryInjectCount, modeVersion: 2 as const }
          // The auto switch controls scheduling only. It must never move the
          // summary boundary or silently mark messages as covered.
          return { ...session, summaryConfig: { ...base, ...patch, modeVersion: 2 as const }, updatedAt: Date.now() }
        })
        const nextSettings = { ...settings, sessions }
        return { settings: nextSettings, messages: getActiveSession(nextSettings)?.messages || [] }
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
      storage: createJSONStorage(() => quotaSafeStorage),
      // `messages` mirrors the active session and used to be persisted a second
      // time at the top level. Long active chats were therefore serialized and
      // parsed twice on every write/startup. Rehydrate rebuilds this mirror.
      partialize: (state) => {
        // Keep only a small warm tail in synchronous localStorage. Serializing
        // 4000+ messages on every send/settings change was the main-thread
        // freeze. The complete session remains durable in /persistent and is
        // hydrated lazily by ChatSync when that conversation is opened.
        const settings = normalizeSettings(state.settings)
        return {
          settings: {
            ...settings,
            sessions: settings.sessions.map((session) => {
              const fullCount = session.partial ? (session.messageCount || session.messages.length) : session.messages.length
              const active = session.id === settings.activeSessionId
              // Only the active chat gets a 50-message warm tail. Other chats
              // keep metadata only and hydrate on selection. Persisting 100
              // messages + all summaries for every session made startup parse
              // far more than the 50 rows React actually rendered.
              if (!active) return { ...session, messages: [], summaries: [], stageSummaries: [], messageCount: fullCount, partial: fullCount > 0 }
              if (fullCount <= 50) return { ...session, messageCount: fullCount, partial: false }
              return { ...session, messages: session.messages.slice(-50), messageCount: fullCount, partial: true }
            }),
          },
        } as any
      },
      version: 10,
      migrate: (persisted: any) => {
        if (!persisted || typeof persisted !== 'object') return persisted
        const state = persisted.state && typeof persisted.state === 'object' ? persisted.state : persisted
        const raw = state.settings || {}
        captureLegacyCredentials(raw.apiProfiles)
        if (Array.isArray(state.messages) && !raw.sessions) raw.messages = state.messages
        const settings = normalizeSettings(raw)
        state.settings = settings
        state.messages = getActiveSession(settings)?.messages || []
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
    apiProfiles: s.apiProfiles.map(profile => ({
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      defaultModel: profile.defaultModel,
      models: profile.models,
      lastFetchedAt: profile.lastFetchedAt,
      credentialConfigured: profile.credentialConfigured === true,
      upstreamOrigin: profile.upstreamOrigin,
    })),
    starStatus: s.starStatus,
    bookmarks: s.bookmarks,
    summaryTurnSize: s.summaryTurnSize,
    summaryInjectCount: s.summaryInjectCount,
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
