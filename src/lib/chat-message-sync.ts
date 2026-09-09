import type { ChatMessage } from '@/features/chat/state/types'

export type MessageTombstones = Record<string, number>
export const ALL_MESSAGES_TOMBSTONE = '*'

export function normalizeMessageTombstones(value: unknown): MessageTombstones {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value)
    .filter(([id, deletedAt]) => id && Number.isFinite(Number(deletedAt)) && Number(deletedAt) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, deletedAt]) => [id, Number(deletedAt)]))
}

export function mergeMessageTombstones(a: unknown, b: unknown): MessageTombstones {
  const merged = normalizeMessageTombstones(a)
  for (const [id, deletedAt] of Object.entries(normalizeMessageTombstones(b))) {
    merged[id] = Math.max(merged[id] || 0, deletedAt)
  }
  return merged
}

export function messageRevision(message: any): number {
  return Number(message?.timestamp) || 0
}

export function messageDeletedAt(tombstones: MessageTombstones, id: string): number {
  return Math.max(tombstones[id] || 0, tombstones[ALL_MESSAGES_TOMBSTONE] || 0)
}

/** Keep the newest explicit message version; an equal-revision stale copy can
 * never overwrite the first (authoritative) copy or revive a deletion. */
export function mergeChatMessages(existing: any[], incoming: any[], tombstones: MessageTombstones): any[] {
  const byId = new Map<string, any>()
  for (const message of existing || []) if (message?.id) byId.set(String(message.id), message)
  for (const message of incoming || []) {
    const id = String(message?.id || '')
    if (!id) continue
    const current = byId.get(id)
    if (!current || messageRevision(message) > messageRevision(current)) byId.set(id, message)
    else if (messageRevision(message) === messageRevision(current) && message.ccGenerationState === 'settled' && current.ccGenerationState !== 'settled') {
      byId.set(id, { ...current, ccGenerationState: 'settled' })
    }
  }
  return Array.from(byId.values())
    .filter(message => {
      const deletedAt = messageDeletedAt(tombstones, message.id)
      return deletedAt === 0 || deletedAt < messageRevision(message)
    })
    .sort((a, b) => messageRevision(a) - messageRevision(b))
}

export function chatMessageContentForModel(message: Pick<ChatMessage, 'content' | 'tool_calls' | 'sharedCard'>): string {
  const toolSummary = message.tool_calls?.length
    ? `\n${message.tool_calls.map(call => `[调用了${call.name}(${JSON.stringify(call.input).slice(0, 100)}) → ${(call.result || '').slice(0, 150)}]`).join('\n')}`
    : ''
  const card = message.sharedCard
    ? `\n\n[已分享卡片｜${message.sharedCard.kind}]\n${JSON.stringify(message.sharedCard.metadata)}\n${message.sharedCard.body || ''}`
    : ''
  return `${message.content || ''}${toolSummary}${card}`
}
