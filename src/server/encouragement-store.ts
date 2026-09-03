import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { resolveDataPath } from './data/safe-path'

const FILE = resolveDataPath(getDataDir(), 'timeline', 'encouragements.json')

export type EncouragementScope = 'permanent' | 'tags'
export interface Encouragement {
  id: string
  text: string
  scope: EncouragementScope
  tags: string[]
  enabled: boolean
  created_at: string
  updated_at: string
}

const readOptions = {
  fallback: () => [] as Encouragement[],
  fallbackOnInvalid: true,
  validate: (value: unknown) => Array.isArray(value),
}

function read(): Encouragement[] {
  return readJsonFile(FILE, readOptions)
}

function mutate<T>(operation: (items: Encouragement[]) => T | undefined): T | undefined {
  let result: T | undefined
  updateJsonFile(FILE, readOptions, items => {
    result = operation(items)
    return result === undefined ? undefined : items
  })
  return result
}

const tags = (value: any): string[] => Array.from(new Set(
  (Array.isArray(value) ? value : []).map(String).map(tag => tag.trim()).filter(Boolean),
)).slice(0, 20) as string[]

export function listEncouragements(): Encouragement[] {
  return read().sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function createEncouragement(
  text: string,
  scope: EncouragementScope = 'permanent',
  tagList: any[] = [],
): Encouragement {
  const now = new Date().toISOString()
  const encouragement: Encouragement = {
    id: `enc-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
    text: String(text || '').trim().slice(0, 500),
    scope: scope === 'tags' ? 'tags' : 'permanent',
    tags: tags(tagList),
    enabled: true,
    created_at: now,
    updated_at: now,
  }
  if (!encouragement.text) throw new Error('鼓励话不能为空')
  if (encouragement.scope === 'tags' && !encouragement.tags.length) throw new Error('标签鼓励至少选择一个标签')
  mutate(items => { items.unshift(encouragement); return encouragement })
  return encouragement
}

export function createManyEncouragements(items: any[]): Encouragement[] {
  return items.map(item => createEncouragement(item.text, item.scope, item.tags))
}

export function updateEncouragement(id: string, patch: Partial<Encouragement>): Encouragement {
  const updated = mutate(items => {
    const encouragement = items.find(item => item.id === id)
    if (!encouragement) throw new Error('鼓励话不存在')
    if (patch.text !== undefined) {
      encouragement.text = String(patch.text).trim().slice(0, 500)
      if (!encouragement.text) throw new Error('鼓励话不能为空')
    }
    if (patch.scope !== undefined) encouragement.scope = patch.scope === 'tags' ? 'tags' : 'permanent'
    if (patch.tags !== undefined) encouragement.tags = tags(patch.tags)
    if (encouragement.scope === 'tags' && !encouragement.tags.length) throw new Error('标签鼓励至少选择一个标签')
    if (patch.enabled !== undefined) encouragement.enabled = !!patch.enabled
    encouragement.updated_at = new Date().toISOString()
    return encouragement
  })
  if (!updated) throw new Error('鼓励话不存在')
  return updated
}

export function deleteEncouragement(id: string): boolean {
  return mutate(items => {
    const index = items.findIndex(item => item.id === id)
    if (index < 0) return undefined
    items.splice(index, 1)
    return true
  }) === true
}

export function matchingEncouragements(currentTags: string[] = []): Encouragement[] {
  const wanted = new Set(currentTags)
  return listEncouragements().filter(item => item.enabled && (
    item.scope === 'permanent' || item.tags.some(tag => wanted.has(tag))
  ))
}
