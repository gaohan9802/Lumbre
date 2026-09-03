import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile } from '../json-file'
import { resolveDataPath } from '../safe-path'

const THESIS_FILE = resolveDataPath(getDataDir(), 'thesis', 'thesis.json')

export function readThesisState<T>(fallback: () => T): T {
  return readJsonFile(THESIS_FILE, {
    fallback,
    fallbackOnInvalid: true,
    validate: value => !!value && typeof value === 'object' && !Array.isArray(value),
  })
}

export function updateThesisState<T>(fallback: () => T, update: (current: T) => T | undefined): T {
  return updateJsonFile(THESIS_FILE, {
    fallback,
    fallbackOnInvalid: true,
    validate: value => !!value && typeof value === 'object' && !Array.isArray(value),
  }, update)
}
