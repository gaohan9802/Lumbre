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

interface EngawaArchive { days: Record<string, Partial<Record<DailyTool, EngawaCapture>>> }

const FILE = resolveDataPath(getDataDir(), 'engawa-history.json')
const fallback = (): EngawaArchive => ({ days: {} })
const options = {
  fallback,
  fallbackOnInvalid: true,
  validate: (value: unknown) => !!value && typeof value === 'object' && !!(value as EngawaArchive).days && typeof (value as EngawaArchive).days === 'object',
}

export function readEngawaHistory(date?: string) {
  const archive = readJsonFile(FILE, options)
  const dates = Object.keys(archive.days).sort().reverse()
  const selected = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dates[0] || madridDateKey()
  return { date: selected, day: archive.days[selected] || {}, dates }
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
    return { days: { ...archive.days, [date]: { ...(archive.days[date] || {}), [tool]: capture } } }
  })
  return firstCapture
}
