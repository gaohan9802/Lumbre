import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile } from '../json-file'
import { assertDateKey, resolveDataPath } from '../safe-path'

export interface UsageRecord {
  timestamp: string
  inputTokens: number
  outputTokens: number
  model: string
  provider: string
}

const USAGE_DIR = resolveDataPath(getDataDir(), 'usage')

function usageFile(date: string): string {
  return resolveDataPath(USAGE_DIR, `${assertDateKey(date, 'usage date')}.json`)
}

function validRecords(value: unknown): value is UsageRecord[] {
  return Array.isArray(value) && value.every(record => (
    !!record
    && typeof record === 'object'
    && typeof record.timestamp === 'string'
    && typeof record.inputTokens === 'number'
    && Number.isFinite(record.inputTokens)
    && typeof record.outputTokens === 'number'
    && Number.isFinite(record.outputTokens)
    && typeof record.model === 'string'
    && typeof record.provider === 'string'
  ))
}

export function readUsageRecords(date: string): UsageRecord[] {
  return readJsonFile(usageFile(date), {
    fallback: () => [],
    fallbackOnInvalid: true,
    validate: validRecords,
  })
}

export function appendUsageRecord(date: string, record: UsageRecord): void {
  updateJsonFile(usageFile(date), {
    fallback: () => [] as UsageRecord[],
    fallbackOnInvalid: true,
    validate: validRecords,
  }, current => [...current, record])
}
