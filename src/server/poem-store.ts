import { randomUUID } from 'node:crypto'
import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { resolveDataPath } from './data/safe-path'

export type PoemAuthor = 'fire' | 'star'
export interface PoemVersion { text: string; actor: PoemAuthor; at: string }
export interface PoemLine { id: string; author: PoemAuthor; versions: PoemVersion[]; deleted_at?: string }
export interface Poem {
  id: string
  title: string
  lines: PoemLine[]
  turn: PoemAuthor
  archived: boolean
  created_at: string
  updated_at: string
}

interface PoemData { poems: Poem[] }

const FILE = resolveDataPath(getDataDir(), 'poems', 'poems.json')
const options = {
  fallback: (): PoemData => ({ poems: [] }),
  fallbackOnInvalid: true,
  validate: (value: unknown) => !!value && typeof value === 'object' && Array.isArray((value as PoemData).poems),
}

const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max)
const now = () => new Date().toISOString()

function mutate<T>(fn: (data: PoemData) => T): T {
  let result!: T
  updateJsonFile(FILE, options, data => { result = fn(data); return data })
  return result
}

function find(data: PoemData, id: string): Poem {
  const poem = data.poems.find(item => item.id === id)
  if (!poem) throw new Error('诗不存在')
  return poem
}

function nextTurn(poem: Poem): PoemAuthor {
  const last = poem.lines.filter(line => !line.deleted_at).at(-1)
  return last ? (last.author === 'fire' ? 'star' : 'fire') : 'fire'
}

export function listPoems(includeArchived = false): Poem[] {
  return readJsonFile(FILE, options).poems
    .filter(poem => includeArchived || !poem.archived)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
}

export function getPoem(id: string): Poem {
  const poem = listPoems(true).find(item => item.id === id)
  if (!poem) throw new Error('诗不存在')
  return poem
}

export function createPoem(title: unknown = ''): Poem {
  const at = now()
  const poem: Poem = {
    id: randomUUID(), title: clean(title, 120) || '未题', lines: [], turn: 'fire', archived: false,
    created_at: at, updated_at: at,
  }
  return mutate(data => { data.poems.unshift(poem); return poem })
}

export function appendPoemLine(id: string, actor: PoemAuthor, value: unknown): Poem {
  const text = clean(value, 2000)
  if (!text) throw new Error('诗句不能为空')
  return mutate(data => {
    const poem = find(data, id)
    if (poem.archived) throw new Error('这首诗已归档')
    if (poem.turn !== actor) throw new Error(`现在该${poem.turn === 'fire' ? '小火' : '星星'}写`)
    const at = now()
    poem.lines.push({ id: randomUUID(), author: actor, versions: [{ text, actor, at }] })
    poem.turn = actor === 'fire' ? 'star' : 'fire'
    poem.updated_at = at
    return poem
  })
}

export function editPoemLine(id: string, lineId: string, actor: PoemAuthor, value: unknown): Poem {
  const text = clean(value, 2000)
  if (!text) throw new Error('诗句不能为空')
  return mutate(data => {
    const poem = find(data, id)
    const line = poem.lines.find(item => item.id === lineId && !item.deleted_at)
    if (!line) throw new Error('诗句不存在')
    if (line.author !== actor) throw new Error('只能修改自己写的诗句')
    const current = line.versions.at(-1)?.text
    if (current !== text) line.versions.push({ text, actor, at: now() })
    poem.updated_at = now()
    return poem
  })
}

export function updatePoem(id: string, patch: { title?: unknown; archived?: unknown }): Poem {
  return mutate(data => {
    const poem = find(data, id)
    if (patch.title !== undefined) poem.title = clean(patch.title, 120) || '未题'
    if (patch.archived !== undefined) poem.archived = !!patch.archived
    poem.updated_at = now()
    return poem
  })
}

export function deletePoemLine(id: string, lineId: string, actor: PoemAuthor): Poem {
  return mutate(data => {
    const poem = find(data, id)
    const line = poem.lines.find(item => item.id === lineId && !item.deleted_at)
    if (!line) throw new Error('诗句不存在')
    if (line.author !== actor) throw new Error('只能删除自己写的诗句')
    line.deleted_at = now()
    poem.turn = nextTurn(poem)
    poem.updated_at = now()
    return poem
  })
}

export function deletePoem(id: string): boolean {
  return mutate(data => {
    const index = data.poems.findIndex(item => item.id === id)
    if (index < 0) return false
    data.poems.splice(index, 1)
    return true
  })
}
