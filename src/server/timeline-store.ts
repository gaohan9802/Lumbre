/** Life timeline — persistent activity tracking in /persistent/timeline/timeline.json */
import fs from 'fs'
import path from 'path'
import { parseMadridDateTime } from '@/lib/madrid-time'

const DATA_DIR = process.env.DATA_DIR || '/persistent'
const DIR = path.join(DATA_DIR, 'timeline')
const FILE = path.join(DIR, 'timeline.json')

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

function ensure() { fs.mkdirSync(DIR, { recursive: true }) }
function read(): TimelineData {
  ensure()
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'))
    return { records: Array.isArray(data.records) ? data.records : [] }
  } catch { return { records: [] } }
}
function write(data: TimelineData) {
  ensure()
  const tmp = FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, FILE)
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
  const data = read()
  const current = data.records.find(r => !r.end_at)
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
  data.records.unshift(record)
  write(data)
  return record
}

export function stopActivity(id?: string, endNote?: string, endAt?: string): TimelineRecord {
  const data = read()
  const record = data.records.find(r => (id ? r.id === id : !r.end_at))
  if (!record || record.end_at) throw new Error('没有正在进行的事情')
  const now = new Date().toISOString()
  const end = validDate(endAt) || now
  if (new Date(end).getTime() < new Date(record.start_at).getTime()) throw new Error('结束时间不能早于开始时间')
  record.end_at = end
  record.end_note = String(endNote || '').trim().slice(0, 2000) || undefined
  record.updated_at = now
  write(data)
  return record
}

export function updateActivity(id: string, patch: Partial<TimelineRecord>): TimelineRecord {
  const data = read()
  const record = data.records.find(r => r.id === id)
  if (!record) throw new Error('记录不存在')
  if (patch.title !== undefined) {
    const title = String(patch.title).trim().slice(0, 120)
    if (!title) throw new Error('事情名称不能为空')
    record.title = title
  }
  if (patch.tags !== undefined) record.tags = cleanTags(patch.tags)
  if (patch.note !== undefined) record.note = String(patch.note || '').trim().slice(0, 2000) || undefined
  if (patch.end_note !== undefined) record.end_note = String(patch.end_note || '').trim().slice(0, 2000) || undefined
  if (patch.start_at !== undefined) record.start_at = validDate(patch.start_at) || record.start_at
  if (patch.end_at !== undefined) record.end_at = patch.end_at ? (validDate(patch.end_at) || record.end_at) : undefined
  if (record.end_at && new Date(record.end_at).getTime() < new Date(record.start_at).getTime()) throw new Error('结束时间不能早于开始时间')
  record.updated_at = new Date().toISOString()
  write(data)
  return record
}

export function deleteActivity(id: string): boolean {
  const data = read()
  const before = data.records.length
  data.records = data.records.filter(r => r.id !== id)
  if (data.records.length === before) return false
  write(data)
  return true
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
