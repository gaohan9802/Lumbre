import type { ChatMessage, MessageVersion } from '@/features/chat/state/types'

export function sessionTitleFromMessage(text: string) {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, 24) : '新的对话'
}

export function snapshotOfMessage(message: ChatMessage): MessageVersion {
  return {
    content: message.content,
    thinking: message.thinking,
    timestamp: message.timestamp,
    input_tokens: message.input_tokens,
    output_tokens: message.output_tokens,
    cache_read_tokens: message.cache_read_tokens,
    cache_creation_tokens: message.cache_creation_tokens,
    tool_calls: message.tool_calls,
    providerId: message.providerId,
    modelId: message.modelId,
    sharedCard: message.sharedCard,
  }
}
