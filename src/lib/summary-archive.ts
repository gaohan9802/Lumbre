export type SummaryArchiveLevel = 'daily' | 'weekly' | 'monthly'

export interface SummaryArchiveWriter {
  conversationId: string
  model?: string
  cacheReadTokens?: number
  cacheCreationTokens?: number
}

export interface SummaryArchiveEntry {
  id: string
  level: SummaryArchiveLevel
  periodKey: string
  startAt: number
  endAt: number
  createdAt: number
  updatedAt: number
  title?: string
  content: string
  partIndex?: number
  partCount?: number
  turnCount?: number
  sourceIds: string[]
  sourceDigest: string
  locked: boolean
  needsCorrection: boolean
  editedAt?: number
  writer?: SummaryArchiveWriter
}

export interface SummaryArchiveStatus {
  running: boolean
  lastAttemptAt?: number
  lastSuccessAt?: number
  error?: string
}

export interface SummaryArchiveSnapshot {
  startedDay?: string
  entries: SummaryArchiveEntry[]
  completedDays: Record<string, 'complete' | 'empty'>
  completedStages: Record<string, 'complete' | 'empty'>
  completedMonths: Record<string, 'complete' | 'empty'>
  status: SummaryArchiveStatus
}
