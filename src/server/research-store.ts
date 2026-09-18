import { randomUUID } from 'node:crypto'
import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { resolveDataPath } from './data/safe-path'

export type ResearchEntity = 'field' | 'tag' | 'topic' | 'entry'
export type ResearchEntryKind = 'thought' | 'question' | 'source' | 'finding'
interface Base { id: string; archived: boolean; operation_key?: string; created_at: string; updated_at: string }
export interface ResearchField extends Base { name: string; description: string }
export interface ResearchTag extends Base { field_id: string; name: string }
export interface ResearchTopic extends Base { field_id: string; title: string; summary: string; tag_ids: string[] }
export interface ResearchEntry extends Base {
  topic_id: string; kind: ResearchEntryKind; title: string; content: string; source_title?: string; source_url?: string
}
interface ResearchData { fields: ResearchField[]; tags: ResearchTag[]; topics: ResearchTopic[]; entries: ResearchEntry[] }

const FILE = resolveDataPath(getDataDir(), 'research', 'research.json')
const empty = (): ResearchData => ({ fields: [], tags: [], topics: [], entries: [] })
const options = {
  fallback: empty, fallbackOnInvalid: true,
  validate: (value: unknown) => !!value && typeof value === 'object'
    && ['fields', 'tags', 'topics', 'entries'].every(key => Array.isArray((value as any)[key])),
}
const now = () => new Date().toISOString()
const clean = (value: unknown, max: number) => String(value || '').trim().slice(0, max)
const ids = (value: unknown) => Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, 20) : []
const publicItem = <T extends Base>({ operation_key: _operationKey, ...item }: T) => item

function mutate<T>(fn: (data: ResearchData) => T): T {
  let result!: T
  updateJsonFile(FILE, options, data => { result = fn(data); return data })
  return result
}

function collection(data: ResearchData, entity: ResearchEntity): Base[] {
  return entity === 'field' ? data.fields : entity === 'tag' ? data.tags : entity === 'topic' ? data.topics : data.entries
}

function find(data: ResearchData, entity: ResearchEntity, id: unknown): any {
  const item = collection(data, entity).find(value => value.id === id)
  if (!item) throw new Error('研究条目不存在')
  return item
}

function assertParent(data: ResearchData, entity: ResearchEntity, input: Record<string, unknown>) {
  if (entity === 'tag' || entity === 'topic') find(data, 'field', input.field_id)
  if (entity === 'entry') find(data, 'topic', input.topic_id)
}

export function researchOverview() {
  const data = readJsonFile(FILE, options)
  return {
    fields: data.fields.filter(item => !item.archived).map(publicItem),
    tags: data.tags.filter(item => !item.archived).map(publicItem),
    topics: data.topics.filter(item => !item.archived).map(topic => ({
      ...publicItem(topic),
      entry_count: data.entries.filter(entry => entry.topic_id === topic.id && !entry.archived).length,
    })),
    recent: data.entries.filter(item => !item.archived).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 8).map(publicItem),
  }
}

export function readResearchTopic(topicId: string, offset = 0, limit = 30) {
  const data = readJsonFile(FILE, options)
  const topic = find(data, 'topic', topicId) as ResearchTopic
  const entries = data.entries.filter(item => item.topic_id === topicId && !item.archived)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  const start = Math.max(0, Math.floor(offset) || 0)
  const count = Math.max(1, Math.min(50, Math.floor(limit) || 30))
  return { topic: publicItem(topic), entries: entries.slice(start, start + count).map(publicItem), next_offset: start + count < entries.length ? start + count : null }
}

export function createResearch(entity: ResearchEntity, input: Record<string, unknown>): Base {
  return mutate(data => {
    const operationKey = clean(input.operation_key, 160)
    const existing = operationKey ? collection(data, entity).find(item => item.operation_key === operationKey) : null
    if (existing) return existing
    assertParent(data, entity, input)
    const at = now()
    const operation = operationKey ? { operation_key: operationKey } : {}
    let item: Base
    if (entity === 'field') item = { id: randomUUID(), ...operation, name: clean(input.name, 100) || '未命名领域', description: clean(input.description, 1000), archived: false, created_at: at, updated_at: at } as ResearchField
    else if (entity === 'tag') item = { id: randomUUID(), ...operation, field_id: String(input.field_id), name: clean(input.name, 100) || '未命名标签', archived: false, created_at: at, updated_at: at } as ResearchTag
    else if (entity === 'topic') item = { id: randomUUID(), ...operation, field_id: String(input.field_id), title: clean(input.title, 180) || '未命名课题', summary: clean(input.summary, 2000), tag_ids: ids(input.tag_ids), archived: false, created_at: at, updated_at: at } as ResearchTopic
    else {
      const kind: ResearchEntryKind = ['question', 'source', 'finding'].includes(String(input.entry_kind)) ? input.entry_kind as ResearchEntryKind : 'thought'
      const content = clean(input.content, 20_000)
      if (!content) throw new Error('研究笔记不能为空')
      const sourceUrl = clean(input.source_url, 2000)
      if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) throw new Error('资料来源必须是 http(s) URL')
      item = {
        id: randomUUID(), ...operation, topic_id: String(input.topic_id), kind, title: clean(input.title, 180), content,
        ...(clean(input.source_title, 300) ? { source_title: clean(input.source_title, 300) } : {}),
        ...(sourceUrl ? { source_url: sourceUrl } : {}),
        archived: false, created_at: at, updated_at: at,
      } as ResearchEntry
    }
    ;(collection(data, entity) as Base[]).push(item)
    return item
  })
}

export function updateResearch(entity: ResearchEntity, id: string, input: Record<string, unknown>): Base {
  return mutate(data => {
    const item: any = find(data, entity, id)
    if (entity === 'field') {
      if (input.name !== undefined) item.name = clean(input.name, 100) || item.name
      if (input.description !== undefined) item.description = clean(input.description, 1000)
    } else if (entity === 'tag') {
      if (input.name !== undefined) item.name = clean(input.name, 100) || item.name
    } else if (entity === 'topic') {
      if (input.title !== undefined) item.title = clean(input.title, 180) || item.title
      if (input.summary !== undefined) item.summary = clean(input.summary, 2000)
      if (input.tag_ids !== undefined) item.tag_ids = ids(input.tag_ids)
    } else {
      if (input.entry_kind !== undefined && ['thought', 'question', 'source', 'finding'].includes(String(input.entry_kind))) item.kind = input.entry_kind
      if (input.title !== undefined) item.title = clean(input.title, 180)
      if (input.content !== undefined) item.content = clean(input.content, 20_000) || item.content
      if (input.source_title !== undefined) item.source_title = clean(input.source_title, 300) || undefined
      if (input.source_url !== undefined) {
        const url = clean(input.source_url, 2000)
        if (url && !/^https?:\/\//i.test(url)) throw new Error('资料来源必须是 http(s) URL')
        item.source_url = url || undefined
      }
    }
    item.updated_at = now()
    return item
  })
}

export function setResearchArchived(entity: ResearchEntity, id: string, archived: boolean): Base {
  return mutate(data => {
    const item = find(data, entity, id)
    item.archived = archived
    item.updated_at = now()
    return item
  })
}
