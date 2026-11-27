import type { ChatAttachment, ChatMessage } from '@/features/chat/state/types'

export type MessageTombstones = Record<string, number>
export const ALL_MESSAGES_TOMBSTONE = '*'
export const MAX_CHAT_ATTACHMENTS = 3
export const MAX_CHAT_ATTACHMENT_BYTES = 128 * 1024

const TEXT_FILE_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'yaml', 'yml', 'xml', 'html', 'htm', 'log', 'rtf',
  'js', 'jsx', 'ts', 'tsx', 'py', 'css', 'scss', 'sql', 'sh', 'java', 'c', 'cc', 'cpp', 'h', 'hpp',
  'go', 'rs', 'swift', 'kt', 'kts',
])

export function isSupportedChatFile(name: string, type: string): boolean {
  const extension = name.toLowerCase().split('.').pop() || ''
  return type.startsWith('text/') || ['application/json', 'application/xml', 'application/rtf'].includes(type) || TEXT_FILE_EXTENSIONS.has(extension)
}

export function normalizeChatAttachments(value: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(value)) return undefined
  const attachments = value.slice(0, MAX_CHAT_ATTACHMENTS).flatMap((item): ChatAttachment[] => {
    if (!item || typeof item !== 'object') return []
    const attachment = item as Record<string, unknown>
    if (typeof attachment.name !== 'string' || typeof attachment.text !== 'string') return []
    const name = attachment.name.replace(/[\r\n]/g, ' ').trim().slice(0, 180)
    if (!name) return []
    const bytes = new TextEncoder().encode(attachment.text)
    const text = new TextDecoder().decode(bytes.slice(0, MAX_CHAT_ATTACHMENT_BYTES))
    return [{
      name,
      type: typeof attachment.type === 'string' ? attachment.type.slice(0, 120) : 'text/plain',
      size: Math.min(MAX_CHAT_ATTACHMENT_BYTES, Math.max(0, Number(attachment.size) || bytes.length)),
      text,
    }]
  })
  return attachments.length ? attachments : undefined
}

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

export function chatMessageContentForModel(message: Pick<ChatMessage, 'content' | 'tool_calls' | 'sharedCard' | 'attachments'>): string {
  const toolSummary = message.tool_calls?.length
    ? `\n${message.tool_calls.map(call => `[调用了${call.name}(${JSON.stringify(call.input).slice(0, 100)}) → ${(call.result || '').slice(0, 150)}]`).join('\n')}`
    : ''
  const card = message.sharedCard
    ? `\n\n[已分享卡片｜${message.sharedCard.kind}]\n${JSON.stringify(message.sharedCard.metadata)}\n${message.sharedCard.body || ''}`
    : ''
  const files = normalizeChatAttachments(message.attachments)?.map(file =>
    `\n\n[文件：${file.name}｜${file.type || 'text/plain'}]\n--- 文件内容开始 ---\n${file.text}\n--- 文件内容结束 ---`,
  ).join('') || ''
  return `${message.content || ''}${toolSummary}${card}${files}`
}
