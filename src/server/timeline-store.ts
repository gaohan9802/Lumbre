/** Life timeline — persistent activity tracking in /persistent/timeline/timeline.json */
import { parseMadridDateTime } from '@/lib/madrid-time'
import { readTimelineState, readTimelineTagData, updateTimelineState, writeTimelineTagData } from './data/repositories/timeline'
export const DEFAULT_TIMELINE_TAGS = ['学习','工作','外出','娱乐','家务','旅行','阅读','运动']

export interface TimelineRecord {
  id: string
  title: string
  tags: string[]
  note?: string
  end_note?: string
  start_at: string
  end_at?: string
  created_at: string
  updated_at: string
}

interface TimelineData { records: TimelineRecord[] }

function emptyTimeline(): TimelineData { return { records: [] } }
function normalizeTimeline(data: TimelineData): TimelineData {
  const records = Array.isArray(data?.records)
    ? data.records.filter(record => (
      !!record
      && typeof record === 'object'
      && typeof record.id === 'string'
      && typeof record.title === 'string'
      && Array.isArray(record.tags)
      && typeof record.start_at === 'string'
    ))
    : []
  return { records }
}
function read(): TimelineData {
  return normalizeTimeline(readTimelineState(emptyTimeline))
}
function mutate<T>(operation: (data: TimelineData) => { result: T; write: boolean }): T {
  let result!: T
  updateTimelineState(emptyTimeline, raw => {
    const data = normalizeTimeline(raw)
    const outcome = operation(data)
    result = outcome.result
    return outcome.write ? data : undefined
  })
  return result
}
export function getTimelineTags(): string[] {
  const value = readTimelineTagData()
  return Array.isArray(value) && value.length
    ? Array.from(new Set(value.map(String).map(tag => tag.trim()).filter(Boolean))).slice(0, 30)
    : DEFAULT_TIMELINE_TAGS
}
export function setTimelineTags(input: unknown): string[] {
  const list = Array.isArray(input) ? Array.from(new Set(input.map(String).map(tag => tag.trim()).filter(Boolean))).slice(0, 30) : DEFAULT_TIMELINE_TAGS
  if (!list.length) throw new Error('至少保留一个标签')
  writeTimelineTagData(list)
  return list
}
function cleanTags(tags: unknown): string[] {
  const list = Array.isArray(tags) ? tags : typeof tags === 'string' ? tags.split(/[,，\s]+/) : []
  return Array.from(new Set(list.map(String).map(s => s.trim()).filter(Boolean))).slice(0, 12)
}
function validDate(value: unknown): string | undefined {
  if (!value) return undefined
  const d = parseMadridDateTime(value)
  return d ? d.toISOString() : undefined
}

export function getCurrentActivity(): TimelineRecord | null {
  return read().records.find(r => !r.end_at) || null
}

export function startActivity(title: string, tags?: unknown, note?: string, startAt?: string): TimelineRecord {
  return mutate(data => {
    const current = data.records.find(record => !record.end_at)
    if (current) throw new Error(`已经在做「${current.title}」`)
    const now = new Date().toISOString()
    const start = validDate(startAt) || now
    const record: TimelineRecord = {
      id: `tl-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
      title: String(title || '').trim().slice(0, 120),
      tags: cleanTags(tags),
      note: String(note || '').trim().slice(0, 2000) || undefined,
      start_at: start,
      created_at: now,
      updated_at: now,
    }
    if (!record.title) throw new Error('请填写正在做什么')
    if (!record.tags.length) throw new Error('请选择至少一个标签')
    data.records.unshift(record)
    return { result: record, write: true }
  })
}

export function stopActivity(id?: string, endNote?: string, endAt?: string): TimelineRecord {
  return mutate(data => {
    const record = data.records.find(value => (id ? value.id === id : !value.end_at))
    if (!record || record.end_at) throw new Error('没有正在进行的事情')
    const now = new Date().toISOString()
    const end = validDate(endAt) || now
    if (new Date(end).getTime() < new Date(record.start_at).getTime()) throw new Error('结束时间不能早于开始时间')
    record.end_at = end
    record.end_note = String(endNote || '').trim().slice(0, 2000) || undefined
    record.updated_at = now
    return { result: record, write: true }
  })
}

export function updateActivity(id: string, patch: Partial<TimelineRecord>): TimelineRecord {
  return mutate(data => {
    const record = data.records.find(value => value.id === id)
    if (!record) throw new Error('记录不存在')
    if (patch.title !== undefined) {
      const title = String(patch.title).trim().slice(0, 120)
      if (!title) throw new Error('事情名称不能为空')
      record.title = title
    }
    if (patch.tags !== undefined) { record.tags = cleanTags(patch.tags); if (!record.tags.length) throw new Error('请选择至少一个标签') }
    if (patch.note !== undefined) record.note = String(patch.note || '').trim().slice(0, 2000) || undefined
    if (patch.end_note !== undefined) record.end_note = String(patch.end_note || '').trim().slice(0, 2000) || undefined
    if (patch.start_at !== undefined) record.start_at = validDate(patch.start_at) || record.start_at
    if (patch.end_at !== undefined) record.end_at = patch.end_at ? (validDate(patch.end_at) || record.end_at) : undefined
    if (record.end_at && new Date(record.end_at).getTime() < new Date(record.start_at).getTime()) throw new Error('结束时间不能早于开始时间')
    record.updated_at = new Date().toISOString()
    return { result: record, write: true }
  })
}

export function deleteActivity(id: string): boolean {
  return mutate(data => {
    const before = data.records.length
    data.records = data.records.filter(record => record.id !== id)
    return data.records.length === before
      ? { result: false, write: false }
      : { result: true, write: true }
  })
}

export function listActivities(from?: string, to?: string): TimelineRecord[] {
  const data = read()
  const fromMs = from ? new Date(from).getTime() : -Infinity
  const toMs = to ? new Date(to).getTime() : Infinity
  const now = Date.now()
  return data.records
    .filter(r => {
      const start = new Date(r.start_at).getTime()
      const end = r.end_at ? new Date(r.end_at).getTime() : now
      return end > fromMs && start < toMs
    })
    .sort((a, b) => new Date(b.start_at).getTime() - new Date(a.start_at).getTime())
}

export function timelineDurationSeconds(record: TimelineRecord, now = Date.now()): number {
  return Math.max(0, Math.floor(((record.end_at ? new Date(record.end_at).getTime() : now) - new Date(record.start_at).getTime()) / 1000))
}
