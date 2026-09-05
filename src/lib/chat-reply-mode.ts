import type { ContentBlock } from '@/features/chat/state/types'

export type ReplyMode = 'long' | 'short'
export const normalizeReplyMode = (value: unknown): ReplyMode => value === 'short' ? 'short' : 'long'
const MARKER = '<!--split-->'

/** Delimiters only occupy their own line outside fenced code. Run on the
 * accumulated text, so transport chunks can end anywhere inside the marker. */
export function splitReplyText(text: string, streaming = false): string[] {
  const segments: string[] = []
  let lines: string[] = []
  let fence = ''
  let fenceLength = 0
  const input = text.split('\n')
  const flush = () => { const part = lines.join('\n').trim(); if (part) segments.push(part); lines = [] }
  input.forEach((line, index) => {
    const trimmed = line.trim()
    const match = /^(`{3,}|~{3,})/.exec(trimmed)
    if (match) {
      if (!fence) { fence = match[1][0]; fenceLength = match[1].length }
      else if (match[1][0] === fence && match[1].length >= fenceLength && new RegExp(`^${fence}+\\s*$`).test(trimmed)) fence = ''
      lines.push(line)
    } else if (!fence && trimmed === MARKER) flush()
    else if (!fence && streaming && index === input.length - 1 && trimmed && MARKER.startsWith(trimmed)) { /* wait for the marker or literal text */ }
    else lines.push(line)
  })
  flush()
  return segments
}

export function segmentReplyBlocks(blocks: ContentBlock[], mode: ReplyMode, streaming = false): ContentBlock[] {
  if (mode !== 'short') return blocks.map(block => ({ ...block }))
  return blocks.flatMap(block => block.type === 'text'
    ? splitReplyText(block.content || '', streaming).map(content => ({ ...block, content }))
    : [{ ...block }])
}

export function replyModePrompt(mode: ReplyMode): string {
  return mode === 'short'
    ? `当前为短聊模式。保持原有人设、关系与记忆，像日常即时聊天一样自然接话。通常一次回复 1–4 个小气泡，每个 1–2 句；简单回应一句即可。减少长篇动作独白、重复总结和连续追问。必要的问题完整回答；对方明确要求展开时可以适当加长。需要多个气泡时，在气泡之间独占一行输出 <!--split-->，不要在代码、链接或工具参数内使用它。不要向用户解释模式或分隔标记。`
    : '当前为长聊模式。保持原有人设、关系与记忆，允许完整叙述、细节描写和故事。按话题自然决定长度，不必为短问题凑字数。回复使用正常段落，不输出气泡分隔标记。'
}

/** Total token budget includes reasoning on the existing gateways. */
export function replyTokenLimit(mode: ReplyMode | undefined, thinkingBudget: number): number {
  const budget = Number.isFinite(thinkingBudget) ? Math.max(0, thinkingBudget) : 8000
  return mode === 'short' ? budget + 2048 : Math.max(16000, budget + 4096)
}

export function mergeConversationMode(a: any, b: any): { conversationMode: ReplyMode; conversationModeUpdatedAt: number } {
  const stamp = (value: any) => Number.isFinite(value?.conversationModeUpdatedAt) ? Math.max(0, value.conversationModeUpdatedAt) : 0
  const source = stamp(b) > stamp(a) || (!a?.conversationMode && b?.conversationMode) ? b : a
  return { conversationMode: normalizeReplyMode(source?.conversationMode), conversationModeUpdatedAt: Math.max(stamp(a), stamp(b)) }
}
