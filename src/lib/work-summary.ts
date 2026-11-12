export interface WorkSummaryEntry {
  kind: 'daily' | 'checkpoint'
  id: string
  sessionId: string
  day: string
  startAt: number
  endAt: number
  createdAt: number
  content: string
  partIndex: number
  partCount: number
  turnCount: number
  sourceIds: string[]
}

export interface WorkSummarySnapshot {
  entries: WorkSummaryEntry[]
  completedDays: Record<string, 'complete' | 'empty'>
  status: { running: boolean; lastAttemptAt?: number; lastSuccessAt?: number; error?: string }
}
