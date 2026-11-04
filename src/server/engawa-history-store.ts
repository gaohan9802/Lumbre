import { madridDateKey } from '@/lib/madrid-time'
import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { resolveDataPath } from './data/safe-path'

export const ENGAWA_DAILY_TOOLS = ['sky_tonight', 'apod', 'daily_art', 'arxiv_new', 'daily_poem', 'on_this_day', 'hobby_corner'] as const
type DailyTool = typeof ENGAWA_DAILY_TOOLS[number]

export interface EngawaCapture {
  captured_at: string
  input: Record<string, unknown>
  result: Record<string, unknown>
}

export interface EngawaLine { text: string; updated_at: string }
interface EngawaArchive {
  days: Record<string, Partial<Record<DailyTool, EngawaCapture>>>
  lines?: Record<string, EngawaLine>
}

const FILE = resolveDataPath(getDataDir(), 'engawa-history.json')
const fallback = (): EngawaArchive => ({ days: {} })
const options = {
  fallback,
  fallbackOnInvalid: true,
  validate: (value: unknown) => !!value && typeof value === 'object' && !!(value as EngawaArchive).days && typeof (value as EngawaArchive).days === 'object',
}

export function readEngawaHistory(date?: string) {
  const archive = readJsonFile(FILE, options)
  const dates = Array.from(new Set([...Object.keys(archive.days), ...Object.keys(archive.lines || {})])).sort().reverse()
  const selected = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dates[0] || madridDateKey()
  return { date: selected, day: archive.days[selected] || {}, line: archive.lines?.[selected] || null, dates }
}

export function writeEngawaLine(value: unknown): EngawaLine {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) throw new Error('豹子一句不能为空')
  if (Array.from(text).length > 40) throw new Error('豹子一句最多四十字')
  const date = madridDateKey()
  const line = { text, updated_at: new Date().toISOString() }
  updateJsonFile(FILE, options, archive => ({ ...archive, lines: { ...(archive.lines || {}), [date]: line } }))
  return line
}

export function archiveEngawaResult(name: string, input: Record<string, unknown>, result: string): boolean {
  if (!ENGAWA_DAILY_TOOLS.includes(name as DailyTool)) return false
  const tool = name as DailyTool
  if (name === 'daily_art' && String(input.keyword || '').trim()) return false
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(result) } catch { return false }
  if (!parsed || parsed.ok !== true) return false
  const explicitDate = name === 'sky_tonight' || name === 'apod' ? String(input.date || parsed.date || '') : ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(explicitDate) ? explicitDate : madridDateKey()
  const capture: EngawaCapture = { captured_at: new Date().toISOString(), input, result: parsed }
  let firstCapture = false
  updateJsonFile(FILE, options, archive => {
    firstCapture = !archive.days[date]?.[tool]
    return { ...archive, days: { ...archive.days, [date]: { ...(archive.days[date] || {}), [tool]: capture } } }
  })
  return firstCapture
}
