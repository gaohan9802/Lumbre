import type { ContentBlock } from '@/features/chat/state/types'

function splitOutsideCodeFences(text: string): string[] {
  const parts: string[] = []
  let lines: string[] = []
  let fence = ''
  let fenceLength = 0
  const flush = () => {
    const value = lines.join('\n').trim()
    if (value) parts.push(value)
    lines = []
  }

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)
    if (marker) {
      if (!fence) {
        fence = marker[1][0]
        fenceLength = marker[1].length
      } else if (marker[1][0] === fence && marker[1].length >= fenceLength) {
        fence = ''
        fenceLength = 0
      }
      lines.push(line)
      continue
    }
    if (!fence && !line.trim()) flush()
    else lines.push(line)
  }
  flush()
  return parts
}

export function unwrapActionParagraph(value: string, streaming = false): string | null {
  const text = value.trim()
  const actionStart = text.startsWith('*') && !text.startsWith('**') && !/^\*\s/.test(text)
  const actionEnd = text.endsWith('*') && !text.endsWith('**')
  const unclosedStreamingAction = streaming && !text.slice(1).includes('*')
  if (!actionStart || (!actionEnd && !unclosedStreamingAction)) return null
  return text.slice(1, actionEnd ? -1 : undefined).trim()
}

function unwrapWholeParagraph(value: string, streaming: boolean) {
  const text = value.trim()
  if (text.startsWith('**') && text.endsWith('**') && text.length > 4) {
    return { content: text.slice(2, -2).trim(), action: false }
  }
  const action = unwrapActionParagraph(text, streaming)
  if (action !== null) return { content: action, action: true }
  return { content: text, action: false }
}

export function presentAssistantBlocks(
  blocks: ContentBlock[],
  options: { split?: boolean; allowTransparentAction?: boolean; streaming?: boolean } = {},
): ContentBlock[] {
  const split = options.split !== false
  const textParts = blocks.flatMap(block => block.type === 'text'
    ? (split ? splitOutsideCodeFences(block.content || '') : [block.content?.trim() || '']).filter(Boolean)
    : [])
  const unwrapped = textParts.map(part => unwrapWholeParagraph(part, options.streaming === true))
  const pureAction = options.allowTransparentAction !== false
    && !blocks.some(block => block.type === 'tool_call')
    && unwrapped.length === 1
    && unwrapped[0].action
  let textIndex = 0
  const presented: ContentBlock[] = []

  for (const block of blocks) {
    if (block.type !== 'text') {
      presented.push({ ...block })
      continue
    }
    const parts = split ? splitOutsideCodeFences(block.content || '') : [block.content?.trim() || '']
    for (const part of parts.filter(Boolean)) {
      const parsed = unwrapWholeParagraph(part, options.streaming === true)
      const presentation: ContentBlock['presentation'] = pureAction && textIndex === 0 ? 'action' : 'bubble'
      textIndex++
      if (parsed.content) presented.push({ ...block, content: parsed.content, presentation })
    }
  }
  return presented
}

