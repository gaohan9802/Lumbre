import { addMadridDays, madridDateKey } from '@/lib/madrid-time'
import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile } from '../json-file'
import { assertDateKey, resolveDataPath } from '../safe-path'

const HEALTH_FILE = resolveDataPath(getDataDir(), 'health', 'daily.json')
const MAX_DAYS = 30

export type HealthDay = {
  date: string
  steps?: number
  sleep_minutes?: number
  synced_at: string
}

type HealthStore = { version: 1; days: HealthDay[] }
type HealthInput = { date?: unknown; steps?: unknown; sleep_minutes?: unknown }
export type HealthRange = 'today' | 'yesterday' | 'week'

export class HealthInputError extends Error {}

function emptyStore(): HealthStore {
  return { version: 1, days: [] }
}

function validStore(value: unknown): value is HealthStore {
  if (!value || typeof value !== 'object' || (value as HealthStore).version !== 1) return false
  const days = (value as HealthStore).days
  return Array.isArray(days) && days.every(day => (
    !!day
    && typeof day.date === 'string'
    && typeof day.synced_at === 'string'
    && (day.steps === undefined || Number.isInteger(day.steps))
    && (day.sleep_minutes === undefined || Number.isInteger(day.sleep_minutes))
  ))
}

function metric(value: unknown, name: string, max: number): number | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value) && value.length === 1) return metric(value[0], name, max)

  let number = value
  if (typeof value === 'string') {
    const text = value.trim().replace(/\s*(?:steps?|步)\s*$/i, '').trim()
    if (/^\d+$/.test(text)) number = Number(text)
    else if (/^\d{1,3}(?:[,.\s]\d{3})+$/.test(text)) number = Number(text.replace(/[,.\s]/g, ''))
    else if (/^\d{4,}[,.]0+$/.test(text)) number = Number(text.replace(',', '.'))
  }

  if (typeof number !== 'number' || !Number.isInteger(number) || number < 0 || number > max) {
    const received = Array.isArray(value) ? `array(${value.length})` : typeof value
    throw new HealthInputError(`${name} must be an integer between 0 and ${max}; received ${received}`)
  }
  return number
}

export function saveHealthSnapshot(input: unknown, now = new Date()): HealthDay {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HealthInputError('body must be a JSON object')
  }
  const values = input as HealthInput
  let date: string
  try {
    date = assertDateKey(String(values.date || ''), 'health date')
  } catch {
    throw new HealthInputError('date must be a real YYYY-MM-DD date')
  }
  const steps = metric(values.steps, 'steps', 200_000)
  const sleepMinutes = metric(values.sleep_minutes, 'sleep_minutes', 1_440)
  if (steps === undefined && sleepMinutes === undefined) {
    throw new HealthInputError('steps or sleep_minutes is required')
  }

  let saved!: HealthDay
  updateJsonFile(HEALTH_FILE, { fallback: emptyStore, validate: validStore }, store => {
    const previous = store.days.find(day => day.date === date)
    saved = { ...previous, date, synced_at: now.toISOString() }
    if (steps !== undefined) saved.steps = steps
    if (sleepMinutes !== undefined) saved.sleep_minutes = sleepMinutes
    return {
      version: 1 as const,
      days: [...store.days.filter(day => day.date !== date), saved]
        .sort((left, right) => left.date.localeCompare(right.date))
        .slice(-MAX_DAYS),
    }
  })
  return saved
}

export function readHealthSummary(range: HealthRange = 'week', now = new Date()) {
  const today = madridDateKey(now)
  const from = range === 'today' ? today : addMadridDays(today, range === 'yesterday' ? -1 : -6)
  const to = range === 'yesterday' ? from : today
  const store = readJsonFile(HEALTH_FILE, { fallback: emptyStore, validate: validStore })
  const days = store.days.filter(day => day.date >= from && day.date <= to)
  return {
    range,
    from,
    to,
    last_synced_at: days.reduce<string | null>((latest, day) => (
      !latest || day.synced_at > latest ? day.synced_at : latest
    ), null),
    days,
  }
}
