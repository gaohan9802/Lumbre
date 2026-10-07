import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile } from '../json-file'
import { resolveDataPath } from '../safe-path'

const MEDIA_FILE = resolveDataPath(getDataDir(), 'media-library', 'library.json')

export function readMediaState<T>(fallback: () => T): T {
  return readJsonFile(MEDIA_FILE, {
    fallback,
    fallbackOnInvalid: true,
    validate: value => !!value && typeof value === 'object' && !Array.isArray(value),
  })
}
export function updateMediaState<T>(fallback: () => T, update: (current: T) => T | undefined): T {
  return updateJsonFile(MEDIA_FILE, {
    fallback,
    fallbackOnInvalid: true,
    validate: value => !!value && typeof value === 'object' && !Array.isArray(value),
  }, update)
}
