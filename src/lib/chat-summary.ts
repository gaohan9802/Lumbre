import type { ChatMessage, ChatSummary } from './chatStore'

export interface SummaryRound {
  messages: ChatMessage[]
  startIndex: number
  endIndex: number
}

export function messagesAfterSummaryAnchor(messages: ChatMessage[], anchorMessageId?: string, anchorTimestamp?: number): ChatMessage[] {
  if (anchorMessageId) {
    const index = messages.findIndex(message => message.id === anchorMessageId)
    if (index >= 0) return messages.slice(index + 1)
  }
  return anchorTimestamp ? messages.filter(message => message.timestamp > anchorTimestamp) : messages
}

export function buildSummaryRounds(messages: ChatMessage[]): SummaryRound[] {
  const rounds: SummaryRound[] = []
  let start = -1
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (message.role === 'user') {
      if (start >= 0) {
        const part = messages.slice(start, i)
        if (part.some(item => item.role === 'assistant')) rounds.push({ messages: part, startIndex: start, endIndex: i - 1 })
      }
      start = i
    }
  }
  if (start >= 0) {
    const part = messages.slice(start)
    if (part.some(item => item.role === 'assistant')) rounds.push({ messages: part, startIndex: start, endIndex: messages.length - 1 })
  }
  return rounds
}

function summaryCoversMessage(summary: ChatSummary, message: ChatMessage) {
  if (summary.sourceMessageIds?.length) return summary.sourceMessageIds.includes(message.id)
  return message.timestamp >= summary.startAt && message.timestamp <= summary.endAt
}

export function isRoundCovered(round: SummaryRound, summaries: ChatSummary[]) {
  return round.messages.every(message => summaries.some(summary => summaryCoversMessage(summary, message)))
}

export function pendingSummaryRounds(messages: ChatMessage[], summaries: ChatSummary[]) {
  return buildSummaryRounds(messages).filter(round => !isRoundCovered(round, summaries))
}

export function newestPendingRounds(messages: ChatMessage[], summaries: ChatSummary[]) {
  return pendingSummaryRounds(messages, summaries).length
}

export function selectSummarySegment(
  messages: ChatMessage[],
  summaries: ChatSummary[],
  turnSize: number,
  autoOnly: boolean,
): ChatMessage[] {
  const rounds = buildSummaryRounds(messages)
  if (!rounds.length) return []

  // Progress is derived from the source messages actually stored by summaries.
  // Always take the earliest contiguous uncovered block so there is one strict
  // boundary between “already summarized” and “not summarized yet”.
  let group: SummaryRound[] = []
  for (const round of rounds) {
    if (isRoundCovered(round, summaries)) {
      if (group.length) break
      continue
    }
    group.push(round)
  }
  if (!group.length || (autoOnly && group.length < turnSize)) return []
  const chosen = group.slice(0, Math.min(turnSize, group.length))
  return messages.slice(chosen[0].startIndex, chosen[chosen.length - 1].endIndex + 1)
}
