import { addMadridDays, APP_TIME_ZONE, formatMadrid, madridDateKey } from '@/lib/madrid-time'
import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile } from '../json-file'
import { assertDateKey, resolveDataPath } from '../safe-path'

const HEALTH_FILE = resolveDataPath(getDataDir(), 'health', 'daily.json')
const MAX_DAYS = 30

const NUMERIC_METRICS = {
  steps: { min: 0, max: 200_000, integer: true },
  sleep_minutes: { min: 0, max: 1_440, integer: true },
  resting_heart_rate_bpm: { min: 0, max: 300 },
  hrv_ms: { min: 0, max: 5_000 },
  active_energy_kcal: { min: 0, max: 50_000 },
  exercise_minutes: { min: 0, max: 1_440 },
  stand_hours: { min: 0, max: 24 },
  walking_running_distance_km: { min: 0, max: 500 },
  vo2_max_ml_kg_min: { min: 0, max: 150 },
  respiratory_rate_per_min: { min: 0, max: 100 },
  blood_oxygen_percent: { min: 0, max: 100 },
  sleeping_wrist_temperature_c: { min: -50, max: 100 },
  sleep_score: { min: 0, max: 100, integer: true },
  weight_kg: { min: 0, max: 500 },
  body_fat_percent: { min: 0, max: 100 },
} as const

type NumericMetricName = keyof typeof NUMERIC_METRICS
type MenstrualFlow = 'none' | 'unspecified' | 'light' | 'medium' | 'heavy'

export type HealthDay = Partial<Record<NumericMetricName, number>> & {
  date: string
  menstruating?: boolean
  menstrual_flow?: MenstrualFlow
  synced_at: string
}

type HealthStore = { version: 1; days: HealthDay[] }
type HealthInput = Partial<Record<NumericMetricName, unknown>> & {
  date?: unknown
  menstruating?: unknown
  menstrual_flow?: unknown
}
export type HealthRange = 'today' | 'yesterday' | 'week'

export class HealthInputError extends Error {}

function madridSyncTime(value: string): string {
  return `${formatMadrid(value)} (${APP_TIME_ZONE})`
}

export function healthDayForDisplay(day: HealthDay) {
  return { ...day, synced_at: madridSyncTime(day.synced_at) }
}

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
    && Object.entries(NUMERIC_METRICS).every(([name, rule]) => {
      const metricValue = day[name as NumericMetricName]
      return metricValue === undefined || (
        Number.isFinite(metricValue)
        && metricValue >= rule.min
        && metricValue <= rule.max
        && (!('integer' in rule) || !rule.integer || Number.isInteger(metricValue))
      )
    })
    && (day.menstruating === undefined || typeof day.menstruating === 'boolean')
    && (day.menstrual_flow === undefined || ['none', 'unspecified', 'light', 'medium', 'heavy'].includes(day.menstrual_flow))
  ))
}

function metric(value: unknown, name: NumericMetricName): number | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value) && value.length === 0) return undefined
  if (Array.isArray(value) && value.length === 1) return metric(value[0], name)
  if (typeof value === 'string' && value.trim() === '') return undefined

  let number = value
  if (typeof value === 'string') {
    const text = value.normalize('NFKC').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').trim()
    const match = text.match(/[-+]?\d[\d,.\s\u00a0\u202f]*/)?.[0].trim()
    if (match) {
      const rule = NUMERIC_METRICS[name]
      if ('integer' in rule && rule.integer === true) {
        let formatted = match
        const decimal = /([,.])(0+)$/.exec(formatted)
        if (decimal && (decimal[2].length !== 3 || formatted.slice(0, decimal.index).includes(decimal[1] === '.' ? ',' : '.'))) {
          formatted = formatted.slice(0, decimal.index)
        }
        const digits = formatted.replace(/[^\d+-]/g, '')
        if (digits) number = Number(digits)
      } else {
        const compact = match.replace(/[\s\u00a0\u202f]/g, '')
        const comma = compact.lastIndexOf(',')
        const dot = compact.lastIndexOf('.')
        const decimalSeparator = comma > dot ? ',' : '.'
        const otherSeparator = decimalSeparator === ',' ? '.' : ','
        const normalized = compact.includes(decimalSeparator)
          ? compact.replaceAll(otherSeparator, '').replace(decimalSeparator, '.')
          : compact
        number = Number(normalized)
      }
    }
  }

  const rule = NUMERIC_METRICS[name]
  const integer = 'integer' in rule && rule.integer === true
  if (
    typeof number !== 'number'
    || !Number.isFinite(number)
    || number < rule.min
    || number > rule.max
    || (integer && !Number.isInteger(number))
  ) {
    const received = Array.isArray(value) ? `array(${value.length})` : typeof value
    const preview = typeof value === 'string' ? `: ${JSON.stringify(value.slice(0, 80))}` : ''
    const kind = integer ? 'an integer' : 'a number'
    throw new HealthInputError(`${name} must be ${kind} between ${rule.min} and ${rule.max}; received ${received}${preview}`)
  }
  return number
}

function booleanMetric(value: unknown): boolean | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value) && value.length === 0) return undefined
  if (Array.isArray(value) && value.length === 1) return booleanMetric(value[0])
  if (typeof value === 'string' && value.trim() === '') return undefined
  if (value === true || value === 1 || value === '1') return true
  if (value === false || value === 0 || value === '0') return false
  throw new HealthInputError('menstruating must be true, false, 1 or 0')
}

function menstrualFlowMetric(value: unknown): MenstrualFlow | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value) && value.length === 0) return undefined
  if (Array.isArray(value) && value.length === 1) return menstrualFlowMetric(value[0])
  if (typeof value === 'string' && value.trim() === '') return undefined
  const flow = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (flow === 'none' || flow === 'unspecified' || flow === 'light' || flow === 'medium' || flow === 'heavy') return flow
  throw new HealthInputError('menstrual_flow must be none, unspecified, light, medium or heavy')
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
  const metrics = Object.fromEntries(Object.keys(NUMERIC_METRICS).flatMap(name => {
    const metricName = name as NumericMetricName
    const parsed = metric(values[metricName], metricName)
    return parsed === undefined ? [] : [[metricName, parsed]]
  })) as Partial<Record<NumericMetricName, number>>
  const menstruating = booleanMetric(values.menstruating)
  const menstrualFlow = menstrualFlowMetric(values.menstrual_flow)
  if (Object.keys(metrics).length === 0 && menstruating === undefined && menstrualFlow === undefined) {
    throw new HealthInputError('at least one health metric is required')
  }

  let saved!: HealthDay
  updateJsonFile(HEALTH_FILE, { fallback: emptyStore, validate: validStore }, store => {
    const previous = store.days.find(day => day.date === date)
    saved = { ...previous, ...metrics, date, synced_at: now.toISOString() }
    if (menstruating !== undefined) saved.menstruating = menstruating
    if (menstrualFlow !== undefined) saved.menstrual_flow = menstrualFlow
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
  const latest = days.reduce<string | null>((value, day) => (
    !value || day.synced_at > value ? day.synced_at : value
  ), null)
  return {
    range,
    from,
    to,
    last_synced_at: latest ? madridSyncTime(latest) : null,
    days: days.map(healthDayForDisplay),
  }
}
