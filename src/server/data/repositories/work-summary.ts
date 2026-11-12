import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile } from '../json-file'
import { resolveDataPath } from '../safe-path'
import type { WorkSummaryEntry, WorkSummarySnapshot } from '@/lib/work-summary'

const FILE = resolveDataPath(getDataDir(), 'summaries', 'work.json')

function empty(): WorkSummarySnapshot {
  return { entries: [], completedDays: {}, status: { running: false } }
}

function validEntry(value: unknown): value is WorkSummaryEntry {
  const entry = value as WorkSummaryEntry
  return !!entry && typeof entry === 'object' && typeof entry.id === 'string'
    && (entry.kind === 'daily' || entry.kind === 'checkpoint')
    && typeof entry.sessionId === 'string' && typeof entry.day === 'string'
    && Number.isFinite(entry.startAt) && Number.isFinite(entry.endAt)
    && Number.isFinite(entry.createdAt) && typeof entry.content === 'string'
    && Number.isFinite(entry.partIndex) && Number.isFinite(entry.partCount)
    && Number.isFinite(entry.turnCount) && Array.isArray(entry.sourceIds)
}

function valid(value: unknown): value is WorkSummarySnapshot {
  const snapshot = value as WorkSummarySnapshot
  return !!snapshot && typeof snapshot === 'object'
    && Array.isArray(snapshot.entries) && snapshot.entries.every(validEntry)
    && !!snapshot.completedDays && typeof snapshot.completedDays === 'object'
    && Object.values(snapshot.completedDays).every(item => item === 'complete' || item === 'empty')
    && !!snapshot.status && typeof snapshot.status === 'object' && typeof snapshot.status.running === 'boolean'
}

export function readWorkSummaryData() {
  return readJsonFile(FILE, { fallback: empty, validate: valid })
}

export function updateWorkSummaryData(update: (current: WorkSummarySnapshot) => WorkSummarySnapshot) {
  return updateJsonFile(FILE, { fallback: empty, validate: valid }, update)
}
