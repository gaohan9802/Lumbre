import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile } from '../json-file'
import { resolveDataPath } from '../safe-path'

const WISH_FILE = resolveDataPath(getDataDir(), 'wishlist', 'wishlist.json')

export function readWishState<T>(fallback: () => T): T {
  return readJsonFile(WISH_FILE, {
    fallback,
    fallbackOnInvalid: true,
    validate: value => !!value && typeof value === 'object' && !Array.isArray(value),
  })
}

export function updateWishState<T>(fallback: () => T, update: (current: T) => T | undefined): T {
  return updateJsonFile(WISH_FILE, {
    fallback,
    fallbackOnInvalid: true,
    validate: value => !!value && typeof value === 'object' && !Array.isArray(value),
  }, update)
}
