import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile, writeJsonFile } from '../json-file'
import { assertDateKey, resolveDataPath } from '../safe-path'

const PERIOD_DIR = resolveDataPath(getDataDir(), 'period')
const STATE_FILE = resolveDataPath(PERIOD_DIR, 'state.json')
const NOTES_FILE = resolveDataPath(PERIOD_DIR, 'notes.json')

function objectValue(value: unknown): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function periodDate(value: string): string {
  return assertDateKey(value, 'period date')
}

export function readPeriodState<T>(fallback: () => T): T {
  return readJsonFile(STATE_FILE, { fallback, fallbackOnInvalid: true, validate: objectValue })
}

export function updatePeriodState<T>(fallback: () => T, update: (current: T) => T | undefined): T {
  return updateJsonFile(STATE_FILE, { fallback, fallbackOnInvalid: true, validate: objectValue }, update)
}

export function updatePeriodNotes<T>(fallback: () => T, update: (current: T) => T | undefined): T {
  return updateJsonFile(NOTES_FILE, { fallback, fallbackOnInvalid: true, validate: objectValue }, update)
}

export function replacePeriodNotes(value: unknown): void {
  writeJsonFile(NOTES_FILE, value)
}
