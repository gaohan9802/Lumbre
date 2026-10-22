import { mergeConversationMode } from '@/lib/chat-reply-mode'
import { mergeConversationRoute } from '@/lib/chat-route'
import { mergeCcModel } from '@/lib/cc-model'
import { mergeCcContextState, mergeChatWindowConfig } from '@/lib/chat-window-config'
import { mergeChatMessages, mergeMessageTombstones, messageDeletedAt, normalizeMessageTombstones } from '@/lib/chat-message-sync'
/**
 * Durable incremental chat storage.
 *
 * Layout (all below DATA_DIR, normally /persistent):
 *   chat/manifest.json
 *   chat/sessions/<session-id>.json
 *   chat/sessions/<session-id>.bak
 *
 * The old monolithic chat-sync.json is migrated on first access. Public
 * helpers keep the /api/sync protocol stable while avoiding full archive
 * reads and full-file rewrites for ordinary sync cycles.
 */
import { madridDateKey } from '@/lib/madrid-time'
import { sanitizeChatConfig } from './chat/credentials'
import { storeChatImage } from './data/repositories/chat-assets'
import {
  archiveLegacyChatState,
  appendChatSessionMessage,
  chatManifestExists,
  chatManifestMtime,
  ensureChatStorage,
  isValidChatSessionId,
  readChatManifest,
  readChatSession,
  readChatSessionHeader,
  readChatSessionPage,
  readChatSessionRecoveryCopies,
  readChatSessionTail,
  readLegacyChatStates,
  removeChatSession,
  withChatStoreLock,
  writeChatManifest,
  writeChatSession,
} from './data/repositories/chat'

export interface SessionManifestItem {
  id: string
  updatedAt: number
  messageCount: number
  title?: string
  pinned?: boolean
  createdAt?: number
  generationRoute?: 'api' | 'claude-code'
  generationRouteUpdatedAt?: number
  ccModel?: string
  ccModelUpdatedAt?: number
  conversationMode?: 'long' | 'short'
  conversationModeUpdatedAt?: number
  windowConfigUpdatedAt?: number
  ccContextStateUpdatedAt?: number
}

export interface SyncManifest {
  version: 2
  sessions: SessionManifestItem[]
  tombstones: Record<string, number>
  config?: any
  configUpdatedAt: number
}

export interface SyncState {
  sessions: any[]
  tombstones: Record<string, number>
  config?: any
  configUpdatedAt?: number
}

let manifestCache: { mtimeMs: number; value: SyncManifest } | null = null
let initialized = false

function emptyManifest(): SyncManifest {
  return { version: 2, sessions: [], tombstones: {}, configUpdatedAt: 0 }
}

function normalizeManifest(raw: any): SyncManifest {
  return {
    version: 2,
    sessions: Array.isArray(raw?.sessions)
      ? raw.sessions.filter((s: any) => isValidChatSessionId(s?.id)).map((s: any) => ({
          ...mergeConversationMode(s, null),
          ...mergeConversationRoute(s, null),
          ...mergeCcModel(s, null),
          windowConfigUpdatedAt: Math.max(0, Number(s.windowConfigUpdatedAt) || 0),
          ccContextStateUpdatedAt: Math.max(0, Number(s.ccContextStateUpdatedAt) || 0),
          id: String(s.id),
          updatedAt: Number(s.updatedAt) || 0,
          messageCount: Number(s.messageCount) || 0,
          title: typeof s.title === 'string' ? s.title : undefined,
          pinned: !!s.pinned,
          createdAt: Number(s.createdAt) || undefined,
        }))
      : [],
    tombstones: raw?.tombstones && typeof raw.tombstones === 'object' ? raw.tombstones : {},
    config: sanitizeChatConfig(raw?.config),
    configUpdatedAt: Number(raw?.configUpdatedAt) || 0,
  }
}

function summaryCount(session: any) {
  return (Array.isArray(session?.summaries) ? session.summaries.length : 0)
    + (Array.isArray(session?.stageSummaries) ? session.stageSummaries.length : 0)
}

/** Recover summary metadata from the rotating backup/daily snapshots after an
 * older client accidentally uploaded an empty summary array. Message content is
 * never replaced here; only the missing summary layer is restored. */
function recoverMissingSummaries(session: any): any {
  if (!session?.id || summaryCount(session) > 0 || session?._summaryRecoveryV1) return session
  const candidates = (readChatSessionRecoveryCopies(session.id) as any[])
    .filter((candidate: any) => candidate?.id === session.id)
  const source = candidates.find(item => summaryCount(item) > 0)
  if (!source) return session
  return {
    ...session,
    summaries: Array.isArray(source.summaries) ? source.summaries : [],
    stageSummaries: Array.isArray(source.stageSummaries) ? source.stageSummaries : [],
    summaryConfig: session.summaryConfig || source.summaryConfig,
    _summaryRecoveryV1: { at: Date.now(), fromUpdatedAt: Number(source.updatedAt) || 0 },
  }
}

function isBlankSession(s: any) {
  return (s?.messages?.length || 0) === 0 && !(s?.conversationModeUpdatedAt > 0) && !(s?.generationRouteUpdatedAt > 0) && !(s?.ccModelUpdatedAt > 0) && !(s?.windowConfigUpdatedAt > 0) && !(s?.ccContextStateUpdatedAt > 0) && !s?.pinned && (!s?.title || s.title === '新的对话')
}

function mergeSummaryLayer(existing: any, incoming: any) {
  const aRevision = Math.max(0, Number(existing?.summaryRevision) || 0)
  const bRevision = Math.max(0, Number(incoming?.summaryRevision) || 0)
  if (bRevision > aRevision) return {
    summaries: Array.isArray(incoming?.summaries) ? incoming.summaries : [],
    stageSummaries: Array.isArray(incoming?.stageSummaries) ? incoming.stageSummaries : [],
    summaryConfig: incoming?.summaryConfig || existing?.summaryConfig,
    summaryRevision: bRevision,
  }
  if (aRevision > bRevision) return {
    summaries: Array.isArray(existing?.summaries) ? existing.summaries : [],
    stageSummaries: Array.isArray(existing?.stageSummaries) ? existing.stageSummaries : [],
    summaryConfig: existing?.summaryConfig || incoming?.summaryConfig,
    summaryRevision: aRevision,
  }
  // Equal revisions usually mean an older client updated unrelated chat data.
  // Keep the richer summary layer so 21 summaries can never fall back to 20.
  const source = summaryCount(incoming) >= summaryCount(existing) ? incoming : existing
  return {
    summaries: Array.isArray(source?.summaries) ? source.summaries : [],
    stageSummaries: Array.isArray(source?.stageSummaries) ? source.stageSummaries : [],
    summaryConfig: incoming?.summaryConfig || existing?.summaryConfig,
    summaryRevision: aRevision,
  }
}

function pickSessionData(a: any, b: any) {
  const aBlank = isBlankSession(a)
  const bBlank = isBlankSession(b)
  if (aBlank && !bBlank) return b
  if (bBlank && !aBlank) return a
  if ((Number(b?.updatedAt) || 0) <= (Number(a?.updatedAt) || 0)) return a

  // A partial client session contains only the local warm tail. It must never
  // replace the complete durable file. Merge its newly-created tail by id and
  // retain server-only messages + summary metadata.
  if (b?.partial) {
    return { ...a, ...b, ...mergeSummaryLayer(a, b), partial: false }
  }

  // Old/background clients occasionally submit a newer full chat without the
  // summary fields introduced later. Empty metadata must not erase a populated
  // durable summary layer merely because that client opened the conversation.
  return { ...b, ...mergeSummaryLayer(a, b) }
}

function pickSession(a: any, b: any) {
  const winner = pickSessionData(a, b)
  const messageTombstones = mergeMessageTombstones(a?.messageTombstones, b?.messageTombstones)
  const messages = mergeChatMessages(a?.messages || [], b?.messages || [], messageTombstones)
  const merged = {
    ...winner,
    messages,
    messageTombstones,
    messageCount: winner.partial ? Math.max(Number(winner.messageCount) || 0, messages.length) : messages.length,
  }
  const messageLayerChanged = JSON.stringify(messages) !== JSON.stringify(winner?.messages || [])
    || JSON.stringify(messageTombstones) !== JSON.stringify(winner?.messageTombstones || {})
  const mode = mergeConversationMode(a, b)
  const route = mergeConversationRoute(a, b)
  const ccModel = mergeCcModel(a, b)
  const windowConfig = mergeChatWindowConfig(a, b)
  const ccContextState = mergeCcContextState(a, b)
  if ((merged.conversationMode || 'long') === mode.conversationMode &&
      (merged.conversationModeUpdatedAt || 0) === mode.conversationModeUpdatedAt &&
      (merged.generationRoute || 'api') === route.generationRoute &&
      (merged.generationRouteUpdatedAt || 0) === route.generationRouteUpdatedAt &&
      merged.ccModel === ccModel.ccModel &&
      (merged.ccModelUpdatedAt || 0) === ccModel.ccModelUpdatedAt &&
      JSON.stringify(merged.windowConfig) === JSON.stringify(windowConfig.windowConfig) &&
      (merged.windowConfigUpdatedAt || 0) === windowConfig.windowConfigUpdatedAt &&
      JSON.stringify(merged.ccContextState) === JSON.stringify(ccContextState.ccContextState) &&
      (merged.ccContextStateUpdatedAt || 0) === ccContextState.ccContextStateUpdatedAt &&
      !messageLayerChanged) return merged
  return { ...merged, ...mode, ...route, ...ccModel, ...windowConfig, ...ccContextState, updatedAt: Math.max(Number(a.updatedAt) || 0, Number(b.updatedAt) || 0) + 1 }
}

function externalizeSessionImages(session: any): any {
  if (!Array.isArray(session?.messages)) return session
  let changed = false
  const messages = session.messages.map((message: any) => {
    if (!Array.isArray(message?.images)) return message
    let imagesChanged = false
    const images = message.images.map((image: unknown) => {
      if (typeof image !== 'string' || !image.startsWith('data:image/')) return image
      const stored = storeChatImage(image)
      if (stored !== image) imagesChanged = true
      return stored
    })
    if (!imagesChanged) return message
    changed = true
    return { ...message, images }
  })
  return changed ? { ...session, messages } : session
}

function writeSession(session: any, snapshot = true) {
  const stored = externalizeSessionImages(session)
  writeChatSession(stored.id, stored, madridDateKey(), snapshot)
  return stored
}

function ensureSegmentedSession(id: string): any | null {
  const header = readChatSessionHeader(id)
  if (!header) return null
  if (header?._messageStore?.version === 1) return header
  const session = readChatSession(id) as any
  if (!session?.id) return null
  writeSession(externalizeSessionImages(session), false)
  return readChatSessionHeader(id)
}

function removeSession(id: string) {
  try { removeChatSession(id) } catch {}
}

function saveManifest(manifest: SyncManifest) {
  const mtimeMs = writeChatManifest(manifest, madridDateKey())
  manifestCache = mtimeMs === null ? null : { mtimeMs, value: manifest }
}

function sessionManifestItem(session: any, messageCount: number): SessionManifestItem {
  return {
    ...mergeConversationMode(session, null),
    ...mergeConversationRoute(session, null),
    ...mergeCcModel(session, null),
    windowConfigUpdatedAt: Math.max(0, Number(session.windowConfigUpdatedAt) || 0),
    ccContextStateUpdatedAt: Math.max(0, Number(session.ccContextStateUpdatedAt) || 0),
    id: session.id,
    updatedAt: Number(session.updatedAt) || 0,
    messageCount,
    title: session.title,
    pinned: !!session.pinned,
    createdAt: Number(session.createdAt) || 0,
  }
}

function repairManifestSession(manifest: SyncManifest, session: any, messageCount: number): void {
  const current = manifest.sessions.find(item => item.id === session.id)
  if (!current || (current.updatedAt === Number(session.updatedAt) && current.messageCount === messageCount)) return
  saveManifest({
    ...manifest,
    sessions: manifest.sessions.map(item => item.id === session.id ? sessionManifestItem(session, messageCount) : item),
  })
}

function legacyState(): SyncState | null {
  for (const raw of readLegacyChatStates() as any[]) {
    if (raw && Array.isArray(raw.sessions)) return {
      sessions: raw.sessions,
      tombstones: raw.tombstones && typeof raw.tombstones === 'object' ? raw.tombstones : {},
      config: raw.config,
      configUpdatedAt: Number(raw.configUpdatedAt) || 0,
    }
  }
  return null
}

function ensureInitialized() {
  if (initialized && chatManifestExists()) return
  ensureChatStorage()
  if (!chatManifestExists()) {
    const legacy = legacyState()
    if (legacy) {
      const tombstones = legacy.tombstones || {}
      const sessions = legacy.sessions
        .filter(s => s?.id && !isBlankSession(s))
        .filter(s => !(tombstones[s.id] && tombstones[s.id] >= (Number(s.updatedAt) || 0)))
      for (const session of sessions) writeSession(session, false)
      saveManifest({
        version: 2,
        sessions: sessions.map(s => ({ ...mergeConversationMode(s, null), ...mergeConversationRoute(s, null), ...mergeCcModel(s, null), windowConfigUpdatedAt: Math.max(0, Number(s.windowConfigUpdatedAt) || 0), ccContextStateUpdatedAt: Math.max(0, Number(s.ccContextStateUpdatedAt) || 0), id: s.id, updatedAt: Number(s.updatedAt) || 0, messageCount: s.messages?.length || 0, title: s.title, pinned: !!s.pinned, createdAt: Number(s.createdAt) || 0 })),
        tombstones,
        config: sanitizeChatConfig(legacy.config),
        configUpdatedAt: Number(legacy.configUpdatedAt) || 0,
      })
      // Keep the old archive as an untouched migration backup.
      archiveLegacyChatState()
    } else saveManifest(emptyManifest())
  }
  initialized = true
}

export function loadSyncManifest(): SyncManifest {
  ensureInitialized()
  const mtimeMs = chatManifestMtime()
  if (mtimeMs !== null) {
    if (manifestCache?.mtimeMs === mtimeMs) return manifestCache.value
    const raw = readChatManifest() as any
    const value = normalizeManifest(raw)
    if (JSON.stringify(raw?.config) !== JSON.stringify(value.config)) saveManifest(value)
    else manifestCache = { mtimeMs, value }
    return value
  }
  return normalizeManifest(readChatManifest() || emptyManifest())
}

export function loadSyncSessions(ids: string[]): any[] {
  const manifest = loadSyncManifest()
  const allowed = new Set(manifest.sessions.map(s => s.id))
  const result: any[] = []
  for (const id of ids) {
    if (!allowed.has(id)) continue
    const raw = readChatSession(id) as any
    if (raw?.id === id) {
      const session = recoverMissingSummaries(externalizeSessionImages(raw))
      if (session !== raw) writeSession(session, false)
      result.push(session)
    }
  }
  return result
}

/** Return only each conversation's warm tail. Large histories stay on disk
 * until the user explicitly asks for older messages. */
export function loadSyncSessionTails(ids: string[], requestedLimit = 120): any[] {
  const limit = Math.max(20, Math.min(200, Math.floor(requestedLimit) || 120))
  const manifest = loadSyncManifest()
  const allowed = new Set(manifest.sessions.map(session => session.id))
  return ids.flatMap(id => {
    if (!allowed.has(id) || !ensureSegmentedSession(id)) return []
    const session = readChatSessionTail(id, limit)
    return session ? [session] : []
  })
}

/** Read one bounded page immediately before `before` (an index in the durable
 * message array). This keeps mobile clients from ever parsing a whole archive. */
export function loadSyncSessionHistory(id: string, requestedBefore: number, requestedLimit = 50) {
  const manifest = loadSyncManifest()
  if (!manifest.sessions.some(session => session.id === id) || !ensureSegmentedSession(id)) return null
  const limit = Math.max(10, Math.min(100, Math.floor(requestedLimit) || 50))
  const page = readChatSessionPage(id, requestedBefore, limit)
  if (!page) return null
  return {
    sessionId: id,
    messages: page.messages,
    start: page.start,
    total: page.total,
    hasMore: page.start > 0,
  }
}

/** Locate one durable message without sending the whole conversation to a phone. */
export function loadSyncMessageContext(id: string, messageId: string, requestedRadius = 4) {
  if (!messageId || messageId.length > 200) return null
  if (!loadSyncManifest().sessions.some(session => session.id === id)) return null
  const header = ensureSegmentedSession(id)
  const ids = Array.isArray(header?._messageStore?.ids) ? header._messageStore.ids : []
  const targetIndex = ids.indexOf(messageId)
  if (targetIndex < 0) return null
  const radius = Math.max(2, Math.min(10, Math.floor(requestedRadius) || 4))
  const total = Number(header._messageStore.messageCount) || 0
  const start = Math.max(0, targetIndex - radius)
  const end = Math.min(total, targetIndex + radius + 1)
  const page = readChatSessionPage(id, end, end - start)
  if (!page) return null
  return {
    sessionId: id,
    sessionTitle: typeof header.title === 'string' ? header.title : '原聊天',
    targetIndex,
    total,
    messages: page.messages,
  }
}

export function loadSyncState(): SyncState {
  const manifest = loadSyncManifest()
  return {
    sessions: loadSyncSessions(manifest.sessions.map(s => s.id)),
    tombstones: manifest.tombstones,
    config: manifest.config,
    configUpdatedAt: manifest.configUpdatedAt,
  }
}

/** Merge only submitted session files. Returns the compact resulting manifest. */
export function mergeSyncDelta(client: SyncState): SyncManifest {
  return withChatStoreLock(() => mergeSyncDeltaUnlocked(client))
}

function mergeSyncDeltaUnlocked(client: SyncState): SyncManifest {
  // Invalidate the process cache after waiting for another worker's lock.
  manifestCache = null
  const current = loadSyncManifest()
  const tombstones: Record<string, number> = { ...current.tombstones }
  for (const [id, ts] of Object.entries(client.tombstones || {})) {
    tombstones[id] = Math.max(tombstones[id] || 0, Number(ts) || 0)
  }

  const meta = new Map(current.sessions.map(s => [s.id, s]))
  for (const incoming of client.sessions || []) {
    if (!incoming?.id) continue
    const existingMeta = meta.get(incoming.id)
    const submittedMetadataIsStale = existingMeta
      && (Number(incoming.conversationModeUpdatedAt) || 0) <= (existingMeta.conversationModeUpdatedAt || 0)
      && (Number(incoming.generationRouteUpdatedAt) || 0) <= (existingMeta.generationRouteUpdatedAt || 0)
      && (Number(incoming.ccModelUpdatedAt) || 0) <= (existingMeta.ccModelUpdatedAt || 0)
      && (Number(incoming.windowConfigUpdatedAt) || 0) <= (existingMeta.windowConfigUpdatedAt || 0)
      && (Number(incoming.ccContextStateUpdatedAt) || 0) <= (existingMeta.ccContextStateUpdatedAt || 0)
    if (existingMeta && submittedMetadataIsStale && incoming.partial && (Number(incoming.updatedAt) || 0) <= existingMeta.updatedAt) {
      const header = ensureSegmentedSession(incoming.id)
      const ids = new Set(Array.isArray(header?._messageStore?.ids) ? header._messageStore.ids : [])
      if ((incoming.messages || []).every((message: any) => ids.has(String(message?.id || '')))) continue
    }
    const existing = existingMeta ? loadSyncSessions([incoming.id])[0] : null
    const winner = existing ? pickSession(existing, incoming) : incoming
    const deletedAt = tombstones[winner.id] || 0
    if (deletedAt >= (Number(winner.updatedAt) || 0) || isBlankSession(winner)) {
      meta.delete(winner.id)
      removeSession(winner.id)
      continue
    }
    // Do not rewrite an unchanged long session.
    if (!existing || winner !== existing) writeSession(winner)
    meta.set(winner.id, {
      ...mergeConversationMode(winner, null),
      ...mergeConversationRoute(winner, null),
      ...mergeCcModel(winner, null),
      windowConfigUpdatedAt: Math.max(0, Number(winner.windowConfigUpdatedAt) || 0),
      ccContextStateUpdatedAt: Math.max(0, Number(winner.ccContextStateUpdatedAt) || 0),
      id: winner.id,
      updatedAt: Number(winner.updatedAt) || 0,
      messageCount: winner.messages?.length || 0,
      title: winner.title, pinned: !!winner.pinned, createdAt: Number(winner.createdAt) || 0,
    })
  }

  // Apply remote deletions even when the deleted session wasn't submitted.
  for (const [id, item] of Array.from(meta.entries())) {
    if ((tombstones[id] || 0) >= item.updatedAt) {
      meta.delete(id)
      removeSession(id)
    }
  }

  const currentConfigAt = current.configUpdatedAt || 0
  const clientConfigAt = Number(client.configUpdatedAt) || 0
  const useClientConfig = clientConfigAt > currentConfigAt && client.config
  const manifest: SyncManifest = {
    version: 2,
    sessions: Array.from(meta.values()),
    tombstones,
    config: sanitizeChatConfig(useClientConfig ? client.config : current.config),
    configUpdatedAt: useClientConfig ? clientConfigAt : currentConfigAt,
  }
  saveManifest(manifest)
  return manifest
}


/** Atomically append one message to the latest server copy of a session. */
export function appendSyncSessionMessage(sessionId: string, message: any): { appended: boolean; sessionUpdatedAt: number; messageCount: number } {
  return withChatStoreLock(() => {
    manifestCache = null
    const manifest = loadSyncManifest()
    const meta = manifest.sessions.find(item => item.id === sessionId)
    if (!meta) throw new Error(`wake session not found: ${sessionId}`)
    const session = ensureSegmentedSession(sessionId)
    if (!session?.id) throw new Error(`wake session unreadable: ${sessionId}`)
    const messageCount = Number(session?._messageStore?.messageCount) || 0
    const messageTombstones = normalizeMessageTombstones(session.messageTombstones)
    const deletedAt = messageDeletedAt(messageTombstones, String(message?.id || ''))
    if (deletedAt > 0 && deletedAt >= (Number(message?.timestamp) || 0)) {
      return { appended: false, sessionUpdatedAt: Number(session.updatedAt) || 0, messageCount }
    }
    if (session._messageStore.ids.includes(String(message?.id || ''))) {
      repairManifestSession(manifest, session, messageCount)
      return { appended: false, sessionUpdatedAt: Number(session.updatedAt) || 0, messageCount }
    }
    const now = Math.max(Date.now(), (Number(session.updatedAt) || 0) + 1, Number(message?.timestamp) || 0)
    const storedMessage = externalizeSessionImages({ messages: [message] }).messages[0]
    const updated = { ...session, updatedAt: now }
    appendChatSessionMessage(sessionId, storedMessage, updated, madridDateKey())
    const next: SyncManifest = {
      ...manifest,
      sessions: manifest.sessions.map(item => item.id === sessionId
        ? sessionManifestItem(updated, messageCount + 1)
        : item),
    }
    saveManifest(next)
    return { appended: true, sessionUpdatedAt: now, messageCount: messageCount + 1 }
  })
}

/** Atomically append a browser-created message. Creates the session when this
 * is the first message, so a refresh immediately after Send cannot lose it. */
export function upsertSyncSessionMessage(sessionId: string, message: any, meta: any = {}): { appended: boolean; sessionUpdatedAt: number; messageCount: number } {
  return withChatStoreLock(() => {
    manifestCache = null
    const manifest = loadSyncManifest()
    const oldMeta = manifest.sessions.find(item => item.id === sessionId)
    const existing = oldMeta ? ensureSegmentedSession(sessionId) : null
    const base = existing?.id ? existing : {
      id: sessionId,
      title: meta.title || '新的对话',
      messages: [],
      pinned: !!meta.pinned,
      createdAt: Number(meta.createdAt) || Date.now(),
      updatedAt: 0,
      summaries: [],
      stageSummaries: [],
      summaryConfig: meta.summaryConfig,
      ...mergeConversationMode(meta, null),
      ...mergeConversationRoute(meta, null),
      ...mergeCcModel(meta, null),
      ...mergeChatWindowConfig(meta, null),
      ...mergeCcContextState(meta, null),
    }
    const messageCount = Number(base?._messageStore?.messageCount) || (Array.isArray(base.messages) ? base.messages.length : 0)
    const messageTombstones = normalizeMessageTombstones(base.messageTombstones)
    const deletedAt = messageDeletedAt(messageTombstones, String(message?.id || ''))
    if (deletedAt > 0 && deletedAt >= (Number(message?.timestamp) || 0)) {
      return { appended: false, sessionUpdatedAt: Number(base.updatedAt) || 0, messageCount }
    }
    if (base?._messageStore?.ids?.includes(String(message?.id || '')) || base.messages?.some((item: any) => item?.id === message?.id)) {
      if (oldMeta) repairManifestSession(manifest, base, messageCount)
      return { appended: false, sessionUpdatedAt: Number(base.updatedAt) || 0, messageCount }
    }
    const now = Math.max(Date.now(), (Number(base.updatedAt) || 0) + 1, Number(message?.timestamp) || 0)
    const updated = {
      ...base,
      ...mergeConversationMode(base, meta),
      ...mergeConversationRoute(base, meta),
      ...mergeCcModel(base, meta),
      ...mergeChatWindowConfig(base, meta),
      ...mergeCcContextState(base, meta),
      title: meta.title || base.title,
      pinned: meta.pinned !== undefined ? !!meta.pinned : !!base.pinned,
      messages: oldMeta ? undefined : [message],
      messageCount: messageCount + 1,
      partial: false,
      updatedAt: now,
    }
    if (oldMeta) {
      const storedMessage = externalizeSessionImages({ messages: [message] }).messages[0]
      appendChatSessionMessage(sessionId, storedMessage, updated, madridDateKey())
    } else writeSession(updated)
    const item = sessionManifestItem(updated, messageCount + 1)
    const next: SyncManifest = { ...manifest, sessions: oldMeta ? manifest.sessions.map(x => x.id === sessionId ? item : x) : [...manifest.sessions, item] }
    saveManifest(next)
    return { appended: true, sessionUpdatedAt: now, messageCount: messageCount + 1 }
  })
}

// Legacy helpers retained for compatibility with any old server imports.
export function mergeSyncState(a: SyncState, b: SyncState): SyncState {
  const tombstones = { ...(a.tombstones || {}) }
  for (const [id, ts] of Object.entries(b.tombstones || {})) tombstones[id] = Math.max(tombstones[id] || 0, Number(ts) || 0)
  const map = new Map((a.sessions || []).map(s => [s.id, s]))
  for (const s of b.sessions || []) if (s?.id) map.set(s.id, map.has(s.id) ? pickSession(map.get(s.id), s) : s)
  const sessions = Array.from(map.values()).filter(s => !isBlankSession(s) && !((tombstones[s.id] || 0) >= (Number(s.updatedAt) || 0)))
  const useB = (Number(b.configUpdatedAt) || 0) > (Number(a.configUpdatedAt) || 0) && b.config
  return { sessions, tombstones, config: sanitizeChatConfig(useB ? b.config : a.config), configUpdatedAt: useB ? b.configUpdatedAt : a.configUpdatedAt }
}

export function saveSyncState(state: SyncState) {
  // Full compatibility write: submit all provided sessions through v2 storage.
  mergeSyncDelta(state)
}
