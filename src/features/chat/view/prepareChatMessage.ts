import { applyBubbleLayout, composeBubbleLayout } from '@/lib/chat-bubble-composer'
import type { ChatMessage, ContentBlock } from '@/features/chat/state/types'

export interface PencilDrawingResult {
  id: string
  imageUrl: string
  title: string
}

export interface PreparedChatMessage {
  displayContentBlocks?: ContentBlock[]
  firstTextBlockIndex: number
  pencilDrawing: PencilDrawingResult | null
  messageImages?: string[]
  thinkingParts: string[]
}

const cache = new WeakMap<ChatMessage, PreparedChatMessage>()

function parsePencilDrawing(result: unknown): PencilDrawingResult | null {
  if (typeof result !== 'string') return null
  try {
    const value = JSON.parse(result)
    const id = typeof value?.drawing_id === 'string' ? value.drawing_id : ''
    const imageUrl = typeof value?.image_url === 'string' ? value.image_url : ''
    if (!/^drawing-[A-Za-z0-9-]+$/.test(id) || !/^\/api\/pencil-drawings\/raw\/drawing-[A-Za-z0-9-]+$/.test(imageUrl)) return null
    return { id, imageUrl, title: typeof value?.title === 'string' ? value.title : '' }
  } catch { return null }
}

export function prepareChatMessage(message: ChatMessage): PreparedChatMessage {
  const cached = cache.get(message)
  if (cached) return cached
  const isUser = message.role === 'user'
  const baseDisplayBlocks: ContentBlock[] | undefined = !isUser
    ? (message.content_blocks?.length ? message.content_blocks : (message.replyMode === 'short' && message.content.trim() ? [{ type: 'text', content: message.content }] : undefined))
    : undefined
  const displayContentBlocks = baseDisplayBlocks
    ? (message.replyMode === 'short' ? applyBubbleLayout(baseDisplayBlocks, message.bubbleLayout || composeBubbleLayout(baseDisplayBlocks)) : baseDisplayBlocks)
    : undefined
  const firstTextBlockIndex = displayContentBlocks?.findIndex(block => block.type === 'text' && !!block.content?.trim()) ?? -1
  const call = !isUser ? [...(message.tool_calls || [])].reverse().find(item => item.name === 'draw_picture') : undefined
  const pencilDrawing = parsePencilDrawing(call?.result)
  const blockThinkingParts = displayContentBlocks
    ?.filter((block): block is ContentBlock & { content: string } => block.type === 'thinking' && typeof block.content === 'string' && !!block.content.trim())
    .map(block => block.content) || []
  const prepared = {
    displayContentBlocks,
    firstTextBlockIndex,
    pencilDrawing,
    messageImages: pencilDrawing ? [pencilDrawing.imageUrl] : message.images,
    thinkingParts: blockThinkingParts.length > 0 ? blockThinkingParts : (message.thinking?.trim() ? [message.thinking] : []),
  }
  cache.set(message, prepared)
  return prepared
}
