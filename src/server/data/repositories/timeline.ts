import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile, writeJsonFile } from '../json-file'
import { resolveDataPath } from '../safe-path'

const TIMELINE_DIR = resolveDataPath(getDataDir(), 'timeline')
const TIMELINE_FILE = resolveDataPath(TIMELINE_DIR, 'timeline.json')
const TAGS_FILE = resolveDataPath(TIMELINE_DIR, 'tags.json')

export function readTimelineState<T>(fallback: () => T): T {
  return readJsonFile(TIMELINE_FILE, {
    fallback,
    fallbackOnInvalid: true,
    validate: value => !!value && typeof value === 'object' && !Array.isArray(value),
  })
}

export function updateTimelineState<T>(fallback: () => T, update: (current: T) => T | undefined): T {
  return updateJsonFile(TIMELINE_FILE, {
    fallback,
    fallbackOnInvalid: true,
    validate: value => !!value && typeof value === 'object' && !Array.isArray(value),
  }, update)
}

export function readTimelineTagData(): unknown {
  return readJsonFile(TAGS_FILE, { fallback: () => [] as unknown[], fallbackOnInvalid: true })
}

export function writeTimelineTagData(tags: string[]): void {
  writeJsonFile(TAGS_FILE, tags)
}
