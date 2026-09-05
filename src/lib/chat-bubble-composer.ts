import type { BubbleLayout, BubbleSegment, ContentBlock } from '@/features/chat/state/types'

const LAYOUT_VERSION = 2 as const
const MIN_BUBBLE_LENGTH = 4
const IDEAL_BUBBLE_LENGTH = 96
const MAX_BUBBLE_LENGTH = 180
const LEGACY_MARKER = /^\s*<!--\s*split\s*-->\s*$/gim

type Candidate = { at: number; score: number }
type ProtectedSpan = { start: number; end: number; kind: BubbleSegment['kind'] }

export function cleanLegacyBubbleMarkers(text: string): string {
  return text.replace(LEGACY_MARKER, '')
}

export function cleanReplyBlocks(blocks: ContentBlock[]): ContentBlock[] {
  return blocks.map(block => block.type === 'text'
    ? { ...block, content: cleanLegacyBubbleMarkers(block.content || '') }
    : { ...block })
}

function visibleLength(text: string): number {
  return Array.from(text.trim()).length
}

function markSpan(mask: boolean[], spans: ProtectedSpan[], start: number, end: number, kind: BubbleSegment['kind']) {
  if (end <= start) return
  spans.push({ start, end, kind })
  for (let index = start; index < end; index++) mask[index] = true
}

function protectedSpans(text: string): { mask: boolean[]; spans: ProtectedSpan[] } {
  const mask = Array.from({ length: text.length }, () => false)
  const spans: ProtectedSpan[] = []
  const lines: RegExpExecArray[] = []
  const linePattern = /^.*(?:\n|$)/gm
  let lineMatch: RegExpExecArray | null
  while ((lineMatch = linePattern.exec(text)) !== null && lineMatch[0]) lines.push(lineMatch)
  let fenceStart = -1
  let fenceChar = ''
  let fenceLength = 0
  for (const line of lines) {
    const start = line.index || 0
    const trimmed = line[0].trim()
    const fence = /^(`{3,}|~{3,})/.exec(trimmed)
    if (fence && fenceStart < 0) {
      fenceStart = start
      fenceChar = fence[1][0]
      fenceLength = fence[1].length
    } else if (fence && fenceStart >= 0 && fence[1][0] === fenceChar && fence[1].length >= fenceLength) {
      markSpan(mask, spans, fenceStart, start + line[0].length, 'code')
      fenceStart = -1
      fenceChar = ''
      fenceLength = 0
    }
  }
  if (fenceStart >= 0) markSpan(mask, spans, fenceStart, text.length, 'code')

  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    const content = line[0].replace(/\n$/, '')
    if (mask[line.index || 0] || !content.includes('|')) { index++; continue }
    let endIndex = index + 1
    while (endIndex < lines.length) {
      const next = lines[endIndex]
      const nextContent = next[0].replace(/\n$/, '')
      if (mask[next.index || 0] || !nextContent.includes('|') || !nextContent.trim()) break
      endIndex++
    }
    const endLine = lines[endIndex - 1]
    markSpan(mask, spans, line.index || 0, (endLine.index || 0) + endLine[0].length, 'table')
    index = endIndex
  }

  for (const line of lines) {
    const start = line.index || 0
    if (mask[start]) continue
    const content = line[0].replace(/\n$/, '')
    const match = /^\s*(?:(?:[-*+]|\d+[.)])\s+|>\s?)/.exec(content)
    if (!match) continue
    markSpan(mask, spans, start, start + line[0].length, content.trimStart().startsWith('>') ? 'quote' : 'list')
  }

  const inlinePattern = /`[^`\n]+`|https?:\/\/[^\s)]+|\]\([^)]+\)/g
  let inline: RegExpExecArray | null
  while ((inline = inlinePattern.exec(text)) !== null) {
    if (!mask[inline.index]) markSpan(mask, spans, inline.index, inline.index + inline[0].length, 'text')
  }
  return { mask, spans: spans.sort((a, b) => a.start - b.start) }
}

function addCandidate(map: Map<number, number>, at: number, score: number, mask: boolean[]) {
  if (at <= 0 || at > mask.length) return
  if ((at < mask.length && mask[at]) || mask[at - 1]) return
  map.set(at, Math.max(map.get(at) || 0, score))
}

function boundaryCandidates(text: string, mask: boolean[], spans: ProtectedSpan[]): Candidate[] {
  const map = new Map<number, number>()
  for (const span of spans) {
    if (span.kind === 'text') continue
    map.set(span.start, 100)
    map.set(span.end, 100)
  }
  for (let index = 0; index < text.length; index++) {
    if (mask[index]) continue
    const char = text[index]
    let end = index + 1
    if (/[。！？!?]/.test(char)) {
      while (end < text.length && /[。！？!?…]/.test(text[end]) && !mask[end]) end++
      while (end < text.length && /[”’」』】）》]/.test(text[end]) && !mask[end]) end++
      addCandidate(map, end, 95, mask)
      index = end - 1
    } else if (char === '\n') {
      const blank = text[index + 1] === '\n'
      addCandidate(map, blank ? index + 2 : end, blank ? 100 : 78, mask)
    } else if (/[；;]/.test(char)) addCandidate(map, end, 86, mask)
    else if (/[：:—–]/.test(char)) addCandidate(map, end, 72, mask)
    else if (/[，,、]/.test(char)) addCandidate(map, end, 56, mask)
    else if (/\s/.test(char)) addCandidate(map, end, 35, mask)
    else {
      const codePoint = text.codePointAt(index) || 0
      if (codePoint >= 0x1f000) {
        end = index + (codePoint > 0xffff ? 2 : 1)
        addCandidate(map, end, 76, mask)
        index = end - 1
      }
    }
  }

  const connector = /(?:但是|所以|然后|不过|而且|因为|其实|只是|如果|那就|另外|最后|同时|可是|于是)/g
  let match: RegExpExecArray | null
  while ((match = connector.exec(text)) !== null) addCandidate(map, match.index, 68, mask)

  try {
    const Segmenter = (Intl as any).Segmenter
    if (Segmenter) {
      const iterator = new Segmenter('zh-CN', { granularity: 'word' }).segment(text)
      for (const part of iterator as any) addCandidate(map, Number(part.index) + String(part.segment).length, 28, mask)
    }
  } catch {}
  return Array.from(map, ([at, score]) => ({ at, score })).sort((a, b) => a.at - b.at)
}

function protectedAt(spans: ProtectedSpan[], position: number): ProtectedSpan | undefined {
  return spans.find(span => position >= span.start && position < span.end)
}

function chooseFallback(text: string, start: number, candidates: Candidate[], spans: ProtectedSpan[]): number {
  const options = candidates.filter(item => item.at > start && visibleLength(text.slice(start, item.at)) <= MAX_BUBBLE_LENGTH)
  if (options.length) {
    return options.reduce((best, item) => {
      const itemLength = visibleLength(text.slice(start, item.at))
      const bestLength = visibleLength(text.slice(start, best.at))
      const itemRank = item.score * 10 - Math.abs(IDEAL_BUBBLE_LENGTH - itemLength)
      const bestRank = best.score * 10 - Math.abs(IDEAL_BUBBLE_LENGTH - bestLength)
      return itemRank > bestRank ? item : best
    }).at
  }
  const fallback = graphemeBoundaryAtMost(text, start, MAX_BUBBLE_LENGTH)
  const protectedSpan = protectedAt(spans, fallback)
  if (!protectedSpan) return fallback
  return protectedSpan.start > start ? protectedSpan.start : protectedSpan.end
}

function graphemeBoundaryAtMost(text: string, start: number, count: number): number {
  try {
    const Segmenter = (Intl as any).Segmenter
    if (Segmenter) {
      const iterator = new Segmenter('zh-CN', { granularity: 'grapheme' }).segment(text.slice(start))
      let seen = 0
      let end = start
      for (const part of iterator as any) {
        if (seen >= count) break
        end = start + Number(part.index) + String(part.segment).length
        seen++
      }
      if (end > start) return end
    }
  } catch {}
  const pieces = Array.from(text.slice(start, start + count * 2)).slice(0, count)
  return start + Math.max(1, pieces.join('').length)
}

function textRanges(text: string): Array<Omit<BubbleSegment, 'blockIndex'>> {
  if (!text.trim()) return []
  const { mask, spans } = protectedSpans(text)
  const candidates = boundaryCandidates(text, mask, spans)
  const atomicSpans = spans.filter(span => span.kind !== 'text')
  const ranges: Array<Omit<BubbleSegment, 'blockIndex'>> = []
  let start = 0
  while (start < text.length) {
    const protectedBlock = protectedAt(atomicSpans, start)
    if (protectedBlock) {
      ranges.push({ start, end: protectedBlock.end, kind: protectedBlock.kind })
      start = protectedBlock.end
      continue
    }
    const nextProtected = atomicSpans.find(span => span.start > start)
    const limit = nextProtected ? nextProtected.start : text.length
    if (limit <= start) { start = Math.max(start + 1, limit); continue }
    const strong = candidates.find(item => item.at > start && item.at <= limit && item.score >= 86 &&
      visibleLength(text.slice(start, item.at)) >= MIN_BUBBLE_LENGTH && visibleLength(text.slice(start, item.at)) <= MAX_BUBBLE_LENGTH)
    let end = strong?.at
    if (!end) {
      const atIdeal = candidates.find(item => item.at > start && item.at <= limit && item.score >= 68 && visibleLength(text.slice(start, item.at)) >= IDEAL_BUBBLE_LENGTH)
      end = atIdeal?.at
    }
    if (!end && visibleLength(text.slice(start, limit)) > MAX_BUBBLE_LENGTH) end = chooseFallback(text.slice(0, limit), start, candidates, spans)
    if (!end) end = limit
    ranges.push({ start, end, kind: 'text' })
    start = end
  }

  const clean: Array<Omit<BubbleSegment, 'blockIndex'>> = []
  let leadingWhitespaceStart: number | undefined
  for (const range of ranges) {
    if (text.slice(range.start, range.end).trim()) {
      clean.push(leadingWhitespaceStart == null ? range : { ...range, start: leadingWhitespaceStart })
      leadingWhitespaceStart = undefined
    } else if (clean.length) {
      clean[clean.length - 1].end = range.end
    } else {
      leadingWhitespaceStart = range.start
    }
  }
  if (clean.length > 1 && visibleLength(text.slice(clean[clean.length - 1].start, clean[clean.length - 1].end)) < MIN_BUBBLE_LENGTH) {
    clean[clean.length - 2].end = clean[clean.length - 1].end
    clean.pop()
  }
  return clean
}

export function composeBubbleLayout(blocks: ContentBlock[]): BubbleLayout {
  const segments: BubbleSegment[] = []
  blocks.forEach((block, blockIndex) => {
    if (block.type !== 'text' || !block.content?.trim()) return
    textRanges(block.content).forEach(range => segments.push({ blockIndex, ...range }))
  })
  return { version: LAYOUT_VERSION, segments }
}

export function applyBubbleLayout(blocks: ContentBlock[], layout?: BubbleLayout): ContentBlock[] {
  if (!layout || layout.version !== LAYOUT_VERSION) return blocks.map(block => ({ ...block }))
  const byBlock = new Map<number, BubbleSegment[]>()
  for (const segment of layout.segments) {
    const list = byBlock.get(segment.blockIndex) || []
    list.push(segment)
    byBlock.set(segment.blockIndex, list)
  }
  return blocks.flatMap((block, blockIndex) => {
    if (block.type !== 'text') return [{ ...block }]
    const ranges = (byBlock.get(blockIndex) || []).sort((a, b) => a.start - b.start)
    if (!ranges.length) return block.content?.trim() ? [{ ...block }] : []
    const content = block.content || ''
    const valid = ranges[0].start === 0 && ranges[ranges.length - 1].end === content.length &&
      ranges.every((range, index) => range.blockIndex === blockIndex && range.end <= content.length &&
        (index === 0 || ranges[index - 1].end === range.start))
    if (!valid) return content.trim() ? [{ ...block }] : []
    return ranges.map(range => ({ ...block, content: content.slice(range.start, range.end).trim() })).filter(item => item.content)
  })
}

export function composeBubbleBlocks(blocks: ContentBlock[]): { blocks: ContentBlock[]; layout: BubbleLayout } {
  const clean = cleanReplyBlocks(blocks)
  const layout = composeBubbleLayout(clean)
  return { blocks: applyBubbleLayout(clean, layout), layout }
}
