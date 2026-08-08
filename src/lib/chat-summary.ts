import type { ChatMessage, ChatSummary } from './chatStore'

export interface SummaryRound {
  messages: ChatMessage[]
  startIndex: number
  endIndex: number
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

export function newestPendingRounds(messages: ChatMessage[], summaries: ChatSummary[]) {
  const rounds = buildSummaryRounds(messages)
  let count = 0
  for (let i = rounds.length - 1; i >= 0; i--) {
    if (isRoundCovered(rounds[i], summaries)) break
    count++
  }
  return count
}

export function selectReverseSummarySegment(
  messages: ChatMessage[],
  summaries: ChatSummary[],
  turnSize: number,
  autoOnly: boolean,
): ChatMessage[] {
  const rounds = buildSummaryRounds(messages)
  if (!rounds.length) return []

  const groups: SummaryRound[][] = []
  let group: SummaryRound[] = []
  for (const round of rounds) {
    if (isRoundCovered(round, summaries)) {
      if (group.length) groups.push(group)
      group = []
    } else group.push(round)
  }
  if (group.length) groups.push(group)

  // Both automatic and manual generation choose the newest still-uncovered
  // block. Repeated automatic calls therefore walk backward from the present
  // instead of starting at the beginning of the conversation.
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i].length < turnSize) continue
    const chosen = groups[i].slice(-turnSize)
    return messages.slice(chosen[0].startIndex, chosen[chosen.length - 1].endIndex + 1)
  }
  return []
}
