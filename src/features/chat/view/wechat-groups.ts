import type { ChatMessage } from '@/features/chat/state/types'

const GROUP_GAP_MS = 30 * 60 * 1000

export type ChatDisplayItem =
  | { kind: 'message'; key: string; message: ChatMessage; startIndex: number; endIndex: number }
  | { kind: 'wechat'; key: string; messages: ChatMessage[]; startIndex: number; endIndex: number }

function sameLocalDay(a: number, b: number) {
  const first = new Date(a)
  const second = new Date(b)
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate()
}

/** Fold only the view. The canonical message list stays untouched for sync and model context. */
export function groupWechatMessages(messages: ChatMessage[]): ChatDisplayItem[] {
  const result: ChatDisplayItem[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.transport !== 'wechat') {
      result.push({ kind: 'message', key: message.id, message, startIndex: index, endIndex: index })
      continue
    }
    const previous = result.at(-1)
    const previousMessage = previous?.kind === 'wechat' ? previous.messages.at(-1) : undefined
    if (previous?.kind === 'wechat' && previousMessage
      && message.timestamp - previousMessage.timestamp <= GROUP_GAP_MS
      && sameLocalDay(message.timestamp, previousMessage.timestamp)) {
      previous.messages.push(message)
      previous.endIndex = index
      continue
    }
    result.push({ kind: 'wechat', key: `wechat:${message.id}`, messages: [message], startIndex: index, endIndex: index })
  }
  return result
}
