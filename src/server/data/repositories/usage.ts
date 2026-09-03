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
  return Array.isArray(value)
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
