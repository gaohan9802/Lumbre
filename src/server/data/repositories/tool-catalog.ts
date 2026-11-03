import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile } from '../json-file'
import { resolveDataPath } from '../safe-path'

export interface ToolCatalogOverride {
  description?: string
  displayLabel?: string
}

interface ToolCatalogStore {
  version: 1
  overrides: Record<string, ToolCatalogOverride>
}

const FILE = resolveDataPath(getDataDir(), 'tools', 'catalog.json')

function fallback(): ToolCatalogStore {
  return { version: 1, overrides: {} }
}

function validStore(value: unknown): value is ToolCatalogStore {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const store = value as ToolCatalogStore
  return store.version === 1
    && !!store.overrides && typeof store.overrides === 'object' && !Array.isArray(store.overrides)
    && Object.entries(store.overrides).every(([name, override]) => /^[A-Za-z0-9_:-]{1,120}$/.test(name)
      && !!override && typeof override === 'object' && !Array.isArray(override)
      && (override.description === undefined || typeof override.description === 'string')
      && (override.displayLabel === undefined || typeof override.displayLabel === 'string'))
}

export function readToolCatalogOverrides(): Record<string, ToolCatalogOverride> {
  return readJsonFile(FILE, { fallback, validate: validStore }).overrides
}

export function updateToolCatalogOverrides(update: (current: Record<string, ToolCatalogOverride>) => Record<string, ToolCatalogOverride>) {
  return updateJsonFile(FILE, { fallback, validate: validStore }, current => ({
    version: 1 as const,
    overrides: update(current.overrides),
  })).overrides
}
