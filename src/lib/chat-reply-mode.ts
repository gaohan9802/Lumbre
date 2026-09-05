import type { ContentBlock } from '@/features/chat/state/types'

export type ReplyMode = 'long' | 'short'
export const normalizeReplyMode = (value: unknown): ReplyMode => value === 'short' ? 'short' : 'long'
const MARKER = '<!--split-->'
const MAX_SHORT_BUBBLES = 4

function mergeOverflow(parts: string[], separator = ''): string[] {
  const clean = parts.map(part => part.trim()).filter(Boolean)
  if (clean.length <= MAX_SHORT_BUBBLES) return clean
  return [...clean.slice(0, MAX_SHORT_BUBBLES - 1), clean.slice(MAX_SHORT_BUBBLES - 1).join(separator)]
}

function splitNaturalParagraphs(text: string): string[] {
  const parts: string[] = []
  let lines: string[] = []
  let fence = ''
  let fenceLength = 0
  const flush = () => { const part = lines.join('\n').trim(); if (part) parts.push(part); lines = [] }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    const match = /^(`{3,}|~{3,})/.exec(trimmed)
    if (match) {
      if (!fence) { fence = match[1][0]; fenceLength = match[1].length }
      else if (match[1][0] === fence && match[1].length >= fenceLength && new RegExp(`^${fence}+\\s*$`).test(trimmed)) fence = ''
      lines.push(line)
    } else if (!fence && !trimmed) flush()
    else lines.push(line)
  }
  flush()
  return parts
}

function protectedCharacters(text: string): boolean[] {
  const protectedAt = Array.from({ length: text.length }, () => false)
  const protect = (start: number, end: number) => {
    for (let index = start; index < end; index++) protectedAt[index] = true
  }
  const pattern = /`[^`\n]+`|https?:\/\/[^\s)]+|\]\([^)]+\)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) protect(match.index, match.index + match[0].length)
  return protectedAt
}

function splitNaturalSentences(text: string): string[] {
  // A fenced response is kept intact unless the model supplied explicit
  // markers or paragraph breaks. This prevents code from becoming chat bubbles.
  if (/^\s*(`{3,}|~{3,})/m.test(text)) return [text.trim()]
  const protectedAt = protectedCharacters(text)
  const parts: string[] = []
  let start = 0
  for (let index = 0; index < text.length; index++) {
    if (protectedAt[index] || !/[。！？!?]/.test(text[index])) continue
    let end = index + 1
    while (end < text.length && /[。！？!?…]/.test(text[end]) && !protectedAt[end]) end++
    while (end < text.length && /[”’」』】）》]/.test(text[end])) end++
    const part = text.slice(start, end).trim()
    if (part) parts.push(part)
    start = end
    index = end - 1
  }
  const tail = text.slice(start).trim()
  if (tail) parts.push(tail)
  return mergeOverflow(parts.length > 1 ? parts : [text])
}

function splitNaturalReply(text: string): string[] {
  const paragraphs = splitNaturalParagraphs(text)
  if (paragraphs.length > 1) return mergeOverflow(paragraphs, '\n\n')
  return splitNaturalSentences(paragraphs[0] || text)
}

/** Delimiters only occupy their own line outside fenced code. Run on the
 * accumulated text, so transport chunks can end anywhere inside the marker. */
export function splitReplyText(text: string, streaming = false): string[] {
  const segments: string[] = []
  let lines: string[] = []
  let fence = ''
  let fenceLength = 0
  let explicitMarker = false
  const input = text.split('\n')
  const flush = () => { const part = lines.join('\n').trim(); if (part) segments.push(part); lines = [] }
  input.forEach((line, index) => {
    const trimmed = line.trim()
    const match = /^(`{3,}|~{3,})/.exec(trimmed)
    if (match) {
      if (!fence) { fence = match[1][0]; fenceLength = match[1].length }
      else if (match[1][0] === fence && match[1].length >= fenceLength && new RegExp(`^${fence}+\\s*$`).test(trimmed)) fence = ''
      lines.push(line)
    } else if (!fence && trimmed === MARKER) { explicitMarker = true; flush() }
    else if (!fence && streaming && index === input.length - 1 && trimmed && MARKER.startsWith(trimmed)) { /* wait for the marker or literal text */ }
    else lines.push(line)
  })
  flush()
  if (explicitMarker || segments.length !== 1) return segments
  return splitNaturalReply(segments[0])
}

export function segmentReplyBlocks(blocks: ContentBlock[], mode: ReplyMode, streaming = false): ContentBlock[] {
  if (mode !== 'short') return blocks.map(block => ({ ...block }))
  return blocks.flatMap(block => block.type === 'text'
    ? splitReplyText(block.content || '', streaming).map(content => ({ ...block, content }))
    : [{ ...block }])
}

export function replyModePrompt(mode: ReplyMode): string {
  return mode === 'short'
    ? `当前为短聊模式。保持原有人设、关系与记忆，像日常即时聊天一样自然接话。通常一次回复 1–4 个自然短句，每句只表达一个意思；简单回应一句即可。减少长篇动作独白、重复总结和连续追问。必要的问题完整回答；对方明确要求展开时可以适当加长。用自然段组织不同意思，不要解释当前模式。`
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
