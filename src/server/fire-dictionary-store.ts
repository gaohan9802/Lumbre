import { randomUUID } from 'node:crypto'
import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { resolveDataPath } from './data/safe-path'

export type FireDictionaryActor = 'fire' | 'star'

export interface FireDictionaryExample {
  id: string
  content: string
  author: FireDictionaryActor
}

export interface FireDictionaryEntry {
  id: string
  word: string
  pinyin: string
  letter: string
  definition: string
  phrases: string[]
  examples: FireDictionaryExample[]
  created_by: FireDictionaryActor
  updated_by: FireDictionaryActor
  created_at: string
  updated_at: string
}

interface FireDictionaryData { entries: FireDictionaryEntry[] }
export interface FireDictionaryInput {
  word: unknown
  pinyin: unknown
  definition: unknown
  phrases?: unknown
  examples: unknown
}

const FILE = resolveDataPath(getDataDir(), 'fire-dictionary.json')
const fallback = (): FireDictionaryData => ({ entries: [] })
const isActor = (value: unknown): value is FireDictionaryActor => value === 'fire' || value === 'star'
const isEntry = (value: unknown): value is FireDictionaryEntry => {
  const entry = value as Partial<FireDictionaryEntry> | null
  return !!entry && typeof entry.id === 'string' && typeof entry.word === 'string'
    && typeof entry.pinyin === 'string' && typeof entry.letter === 'string'
    && typeof entry.definition === 'string' && Array.isArray(entry.phrases)
    && entry.phrases.every(item => typeof item === 'string') && Array.isArray(entry.examples)
    && entry.examples.every(item => !!item && typeof item.id === 'string' && typeof item.content === 'string' && isActor(item.author))
    && isActor(entry.created_by) && isActor(entry.updated_by)
    && typeof entry.created_at === 'string' && typeof entry.updated_at === 'string'
}
const options = {
  fallback,
  fallbackOnInvalid: true,
  validate: (value: unknown) => {
    const data = value as Partial<FireDictionaryData> | null
    return !!data && typeof data === 'object' && Array.isArray(data.entries) && data.entries.every(isEntry)
  },
}

function text(value: unknown, label: string, max: number): string {
  const result = String(value ?? '').trim()
  if (!result) throw new Error(`${label}不能为空`)
  if (Array.from(result).length > max) throw new Error(`${label}最多${max}个字`)
  return result
}

function list(value: unknown, label: string, maxItems: number, maxLength: number, required = false): string[] {
  if (value == null && !required) return []
  if (!Array.isArray(value)) throw new Error(`${label}必须是列表`)
  const result = Array.from(new Set(value.map(item => text(item, label, maxLength))))
  if (required && !result.length) throw new Error(`至少需要一个${label}`)
  if (result.length > maxItems) throw new Error(`${label}最多${maxItems}条`)
  return result
}

function actor(value: unknown): FireDictionaryActor {
  if (!isActor(value)) throw new Error('身份无效')
  return value
}

function letterOf(pinyin: string): string {
  const match = pinyin.normalize('NFD').match(/[A-Za-z]/)
  return match ? match[0].toUpperCase() : '#'
}

function compareEntries(a: FireDictionaryEntry, b: FireDictionaryEntry): number {
  return a.pinyin.localeCompare(b.pinyin, 'en', { sensitivity: 'base' }) || a.word.localeCompare(b.word, 'zh-CN')
}

const searchable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()

function normalizedInput(input: FireDictionaryInput) {
  if (!input || typeof input !== 'object') throw new Error('词条内容无效')
  const pinyin = text(input.pinyin, '拼音', 120)
  return {
    word: text(input.word, '词语', 50),
    pinyin,
    letter: letterOf(pinyin),
    definition: text(input.definition, '小火释义', 1_000),
    phrases: list(input.phrases, '词组', 20, 80),
    examples: list(input.examples, '例句', 20, 300, true),
  }
}

export function readFireDictionary(filters: { query?: unknown; letter?: unknown; entryId?: unknown; limit?: unknown } = {}) {
  const data = readJsonFile(FILE, options)
  const entryId = String(filters.entryId ?? '').trim()
  if (entryId) return data.entries.find(entry => entry.id === entryId) || null
  const query = searchable(String(filters.query ?? '').trim())
  const letter = String(filters.letter ?? '').trim().toUpperCase()
  const limitValue = filters.limit == null ? data.entries.length : Number(filters.limit)
  const limit = Number.isInteger(limitValue) ? Math.min(1_000, Math.max(1, limitValue)) : data.entries.length
  return data.entries.filter(entry => {
    if (letter && entry.letter !== letter) return false
    if (!query) return true
    return [entry.word, entry.pinyin, entry.definition, ...entry.phrases, ...entry.examples.map(example => example.content)]
      .some(value => searchable(value).includes(query))
  }).sort(compareEntries).slice(0, limit)
}

export function createFireDictionaryEntry(actorValue: unknown, input: FireDictionaryInput): FireDictionaryEntry {
  const author = actor(actorValue)
  const normalized = normalizedInput(input)
  let entry!: FireDictionaryEntry
  updateJsonFile(FILE, options, data => {
    if (data.entries.some(item => item.word.toLocaleLowerCase() === normalized.word.toLocaleLowerCase())) {
      throw new Error('这个词已经在小火辞典里了')
    }
    const now = new Date().toISOString()
    entry = {
      id: `word-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
      ...normalized,
      examples: normalized.examples.map(content => ({ id: randomUUID(), content, author })),
      created_by: author,
      updated_by: author,
      created_at: now,
      updated_at: now,
    }
    return { entries: [...data.entries, entry] }
  })
  return entry
}

export function updateFireDictionaryEntry(actorValue: unknown, idValue: unknown, patch: Partial<FireDictionaryInput>): FireDictionaryEntry {
  const updatedBy = actor(actorValue)
  const id = text(idValue, '词条 id', 100)
  let entry!: FireDictionaryEntry
  updateJsonFile(FILE, options, data => {
    const index = data.entries.findIndex(item => item.id === id)
    if (index < 0) throw new Error('没有找到这个词条')
    const current = data.entries[index]
    const merged = normalizedInput({
      word: patch.word ?? current.word,
      pinyin: patch.pinyin ?? current.pinyin,
      definition: patch.definition ?? current.definition,
      phrases: patch.phrases ?? current.phrases,
      examples: patch.examples ?? current.examples.map(example => example.content),
    })
    if (data.entries.some(item => item.id !== id && item.word.toLocaleLowerCase() === merged.word.toLocaleLowerCase())) {
      throw new Error('这个词已经在小火辞典里了')
    }
    entry = {
      ...current,
      ...merged,
      examples: merged.examples.map((content, index) => current.examples[index]?.content === content
        ? current.examples[index]
        : { id: randomUUID(), content, author: updatedBy }),
      updated_by: updatedBy,
      updated_at: new Date().toISOString(),
    }
    const entries = [...data.entries]
    entries[index] = entry
    return { entries }
  })
  return entry
}

export function deleteFireDictionaryEntry(idValue: unknown): FireDictionaryEntry {
  const id = text(idValue, '词条 id', 100)
  let deleted!: FireDictionaryEntry
  updateJsonFile(FILE, options, data => {
    const index = data.entries.findIndex(item => item.id === id)
    if (index < 0) throw new Error('没有找到这个词条')
    deleted = data.entries[index]
    return { entries: data.entries.filter(item => item.id !== id) }
  })
  return deleted
}
