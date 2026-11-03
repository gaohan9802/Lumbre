import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile } from '../json-file'
import { resolveDataPath } from '../safe-path'
import type { SummaryArchiveEntry, SummaryArchiveSnapshot } from '@/lib/summary-archive'

const ARCHIVE_FILE = resolveDataPath(getDataDir(), 'summaries', 'archive.json')

function emptyArchive(): SummaryArchiveSnapshot {
  return {
    entries: [], completedDays: {}, completedStages: {}, completedMonths: {},
    status: { running: false },
  }
}

function validEntry(value: unknown): value is SummaryArchiveEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as SummaryArchiveEntry
  return typeof entry.id === 'string'
    && ['daily', 'weekly', 'monthly'].includes(entry.level)
    && typeof entry.periodKey === 'string'
    && Number.isFinite(entry.startAt)
    && Number.isFinite(entry.endAt)
    && Number.isFinite(entry.createdAt)
    && Number.isFinite(entry.updatedAt)
    && typeof entry.content === 'string'
    && Array.isArray(entry.sourceIds)
    && entry.sourceIds.every(id => typeof id === 'string')
    && typeof entry.sourceDigest === 'string'
    && typeof entry.locked === 'boolean'
    && typeof entry.needsCorrection === 'boolean'
}

function validStatusMap(value: unknown): value is Record<string, 'complete' | 'empty'> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(status => status === 'complete' || status === 'empty')
}

function validArchive(value: unknown): value is SummaryArchiveSnapshot {
  if (!value || typeof value !== 'object') return false
  const archive = value as SummaryArchiveSnapshot
  return (archive.startedDay === undefined || typeof archive.startedDay === 'string')
    && Array.isArray(archive.entries) && archive.entries.every(validEntry)
    && validStatusMap(archive.completedDays)
    && validStatusMap(archive.completedStages)
    && validStatusMap(archive.completedMonths)
    && !!archive.status && typeof archive.status === 'object'
    && typeof archive.status.running === 'boolean'
}

export function readSummaryArchiveData(): SummaryArchiveSnapshot {
  return readJsonFile(ARCHIVE_FILE, { fallback: emptyArchive, validate: validArchive })
}

export function updateSummaryArchiveData(update: (current: SummaryArchiveSnapshot) => SummaryArchiveSnapshot): SummaryArchiveSnapshot {
  return updateJsonFile(ARCHIVE_FILE, { fallback: emptyArchive, validate: validArchive }, update)
}
