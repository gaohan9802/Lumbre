import { mergeConversationMode } from '@/lib/chat-reply-mode'
import { mergeConversationRoute } from '@/lib/chat-route'
import { mergeChatMessages, mergeMessageTombstones } from '@/lib/chat-message-sync'

export function isBlankSession(session: any) {
  return (session?.messages?.length || 0) === 0
    && !(session?.conversationModeUpdatedAt > 0)
    && !(session?.generationRouteUpdatedAt > 0)
    && !session?.pinned
    && (!session?.title || session.title === '新的对话')
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
  const mode = mergeConversationMode(existing, incoming)
  const route = mergeConversationRoute(existing, incoming)
  const messageTombstones = mergeMessageTombstones(existing?.messageTombstones, incoming?.messageTombstones)
  const incomingIsNewer = Number(incoming?.updatedAt) > Number(existing?.updatedAt)
  const primary = incomingIsNewer ? incoming : existing
  const secondary = incomingIsNewer ? existing : incoming
  const messages = mergeChatMessages(primary?.messages || [], secondary?.messages || [], messageTombstones)
  const messageLayerChanged = JSON.stringify(messages) !== JSON.stringify(base?.messages || [])
    || JSON.stringify(messageTombstones) !== JSON.stringify(base?.messageTombstones || {})
  const needsRepublish = (base.conversationMode || 'long') !== mode.conversationMode || (base.conversationModeUpdatedAt || 0) !== mode.conversationModeUpdatedAt || summaryLayer.summaryRevision > baseRevision
    || (base.generationRoute || 'api') !== route.generationRoute || (base.generationRouteUpdatedAt || 0) !== route.generationRouteUpdatedAt
    || (summaryLayer.summaryRevision === baseRevision && summaryCount(summaryLayer) > summaryCount(base))
    || messageLayerChanged

  return {
    ...base,
    ...mode,
    ...route,
    ...summaryLayer,
    messages,
    messageTombstones,
    messageCount: base.partial ? Math.max(Number(base.messageCount) || 0, messages.length) : messages.length,
    updatedAt: needsRepublish
      ? Math.max(Date.now(), Number(existing?.updatedAt) || 0, Number(incoming?.updatedAt) || 0) + 1
      : base.updatedAt,
  }
}

/** Merge a local and remote copy without crossing sessions or losing summaries. */
export function mergeChatSessionsForSync(existing: any, incoming: any) {
  if (existing?.partial && incoming?.partial) {
    const newer = (incoming.updatedAt || 0) > (existing.updatedAt || 0) ? incoming : existing
    return preserveMergedSummary({ ...existing, ...newer }, existing, incoming)
  }

  if (existing?.partial && !incoming?.partial) {
    if ((existing.updatedAt || 0) <= (incoming.updatedAt || 0)) return preserveMergedSummary(incoming, existing, incoming)
    return preserveMergedSummary({
      ...incoming, ...existing, partial: false,
    }, existing, incoming)
  }

  if (incoming?.partial && !existing?.partial) {
    if ((incoming.updatedAt || 0) <= (existing.updatedAt || 0)) return preserveMergedSummary(existing, existing, incoming)
    return preserveMergedSummary({
      ...existing, ...incoming, partial: false,
    }, existing, incoming)
  }

  if (isBlankSession(existing) && !isBlankSession(incoming)) return { ...incoming, ...mergeConversationMode(existing, incoming), ...mergeConversationRoute(existing, incoming) }
  if (isBlankSession(incoming) && !isBlankSession(existing)) return { ...existing, ...mergeConversationMode(existing, incoming), ...mergeConversationRoute(existing, incoming) }
  const newer = (incoming?.updatedAt || 0) > (existing?.updatedAt || 0) ? incoming : existing
  return preserveMergedSummary(newer, existing, incoming)
}
