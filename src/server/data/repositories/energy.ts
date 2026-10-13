import { addMadridDays, madridDateKey } from '@/lib/madrid-time'
import { caloriesForAmount, exerciseCalories, restingCalories, type BodyMeasurement, type EnergyActor, type EnergyDaySummary, type EnergyEntry, type EnergyEntryKind, type EnergyMeal, type EnergyProfile, type EnergySource, type FormulaSex } from '@/lib/energy'
import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile } from '../json-file'
import { assertDateKey, assertIdentifier, resolveDataPath } from '../safe-path'
import { readHealthDay } from './health'

const ENERGY_FILE = resolveDataPath(getDataDir(), 'health', 'energy.json')
const ENTRY_ID = /^[A-Za-z0-9_-]{1,128}$/
const KINDS: EnergyEntryKind[] = ['food', 'liquid', 'exercise']
const MEALS: EnergyMeal[] = ['breakfast', 'lunch', 'dinner', 'snack']
const SOURCES: EnergySource[] = ['catalog', 'database', 'manual', 'star']

interface EnergyStore {
  version: 1
  profile: EnergyProfile
  measurements: BodyMeasurement[]
  entries: EnergyEntry[]
}

const emptyProfile = (): EnergyProfile => ({ height_cm: null, birth_date: null, formula_sex: null, goal_weight_kg: null, manual_baseline_kcal: null, updated_at: null })
const emptyStore = (): EnergyStore => ({ version: 1, profile: emptyProfile(), measurements: [], entries: [] })

function validNumber(value: unknown, min: number, max: number, nullable = false) {
  return (nullable && value === null) || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max)
}
function validStore(value: unknown): value is EnergyStore {
  if (!value || typeof value !== 'object') return false
  const store = value as EnergyStore
  if (store.version !== 1 || !store.profile || !Array.isArray(store.measurements) || !Array.isArray(store.entries)) return false
  const profile = store.profile
  if (!validNumber(profile.height_cm, 80, 260, true)
    || !(profile.birth_date === null || typeof profile.birth_date === 'string')
    || !(profile.formula_sex === null || ['female', 'male'].includes(profile.formula_sex))
    || !validNumber(profile.goal_weight_kg, 20, 500, true)
    || !validNumber(profile.manual_baseline_kcal, 500, 10_000, true)
    || !(profile.updated_at === null || typeof profile.updated_at === 'string')) return false
  if (!store.measurements.every(item => item && typeof item.id === 'string' && typeof item.date === 'string'
    && validNumber(item.weight_kg, 20, 500) && validNumber(item.body_fat_percent, 0, 100, true)
    && ['fire', 'star'].includes(item.recorded_by) && typeof item.created_at === 'string'
    && (item.updated_at === null || typeof item.updated_at === 'string'))) return false
  return store.entries.every(item => item && typeof item.id === 'string' && typeof item.date === 'string'
    && KINDS.includes(item.kind) && typeof item.name === 'string'
    && validNumber(item.amount, 0, 100_000, true) && (item.unit === null || ['g', 'ml'].includes(item.unit))
    && validNumber(item.kcal_per_100, 0, 2_000, true) && validNumber(item.duration_minutes, 0, 1_440, true)
    && validNumber(item.met, .5, 30, true) && validNumber(item.calories, 0, 20_000)
    && (item.meal === null || MEALS.includes(item.meal)) && typeof item.not_in_health === 'boolean'
    && typeof item.note === 'string' && SOURCES.includes(item.source) && ['fire', 'star'].includes(item.recorded_by)
    && typeof item.created_at === 'string' && (item.updated_at === null || typeof item.updated_at === 'string'))
}
function readStore() {
  return readJsonFile<EnergyStore>(ENERGY_FILE, { fallback: emptyStore, validate: validStore })
}
function cleanText(value: unknown, max: number) {
  return String(value || '').trim().slice(0, max)
}
function number(value: unknown, name: string, min: number, max: number, nullable = false): number | null {
  if (nullable && (value === undefined || value === null || value === '')) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be between ${min} and ${max}`)
  return parsed
}
function date(value: unknown) {
  return assertDateKey(String(value || ''), 'energy date')
}
function latestMeasurement(measurements: BodyMeasurement[], day: string) {
  return [...measurements].filter(item => item.date <= day).sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))[0] || null
}

export function saveEnergyProfile(input: Partial<EnergyProfile>): EnergyProfile {
  const now = new Date().toISOString()
  let saved!: EnergyProfile
  updateJsonFile<EnergyStore>(ENERGY_FILE, { fallback: emptyStore, validate: validStore }, store => {
    const birthDate = input.birth_date === undefined ? store.profile.birth_date : input.birth_date ? date(input.birth_date) : null
    const formulaSex = input.formula_sex === undefined ? store.profile.formula_sex : input.formula_sex
    if (formulaSex !== null && !['female', 'male'].includes(String(formulaSex))) throw new Error('invalid formula sex')
    saved = {
      height_cm: input.height_cm === undefined ? store.profile.height_cm : number(input.height_cm, 'height_cm', 80, 260, true),
      birth_date: birthDate,
      formula_sex: formulaSex as FormulaSex | null,
      goal_weight_kg: input.goal_weight_kg === undefined ? store.profile.goal_weight_kg : number(input.goal_weight_kg, 'goal_weight_kg', 20, 500, true),
      manual_baseline_kcal: input.manual_baseline_kcal === undefined ? store.profile.manual_baseline_kcal : number(input.manual_baseline_kcal, 'manual_baseline_kcal', 500, 10_000, true),
      updated_at: now,
    }
    return { ...store, profile: saved }
  })
  return saved
}

export function saveBodyMeasurement(input: Partial<BodyMeasurement>, actor: EnergyActor): BodyMeasurement {
  const day = date(input.date || madridDateKey())
  const now = new Date().toISOString()
  const weight = number(input.weight_kg, 'weight_kg', 20, 500)!
  const bodyFat = number(input.body_fat_percent, 'body_fat_percent', 0, 100, true)
  if (input.id) assertIdentifier(input.id, ENTRY_ID, 'body measurement id')
  let saved!: BodyMeasurement
  updateJsonFile<EnergyStore>(ENERGY_FILE, { fallback: emptyStore, validate: validStore }, store => {
    const existing = input.id ? store.measurements.find(item => item.id === input.id) : null
    if (input.id && !existing) throw new Error('body measurement not found')
    saved = existing
      ? { ...existing, date: day, weight_kg: weight, body_fat_percent: bodyFat, updated_at: now }
      : { id: `body_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, date: day, weight_kg: weight, body_fat_percent: bodyFat, recorded_by: actor, created_at: now, updated_at: null }
    return { ...store, measurements: existing ? store.measurements.map(item => item.id === existing.id ? saved : item) : [...store.measurements, saved] }
  })
  return saved
}

function normalizeEntry(input: Partial<EnergyEntry>, actor: EnergyActor, store: EnergyStore): Omit<EnergyEntry, 'id' | 'created_at' | 'updated_at'> {
  const day = date(input.date || madridDateKey())
  const kind = String(input.kind || '') as EnergyEntryKind
  if (!KINDS.includes(kind)) throw new Error('invalid energy entry kind')
  const name = cleanText(input.name, 80)
  if (!name) throw new Error('name is required')
  const note = cleanText(input.note, 500)
  const source = SOURCES.includes(input.source as EnergySource) ? input.source as EnergySource : actor === 'star' ? 'star' : 'manual'
  if (kind === 'food' || kind === 'liquid') {
    const amount = number(input.amount, kind === 'food' ? 'grams' : 'milliliters', .1, 100_000)!
    const kcalPer100 = number(input.kcal_per_100, 'kcal_per_100', 0, 2_000)!
    const meal = MEALS.includes(input.meal as EnergyMeal) ? input.meal as EnergyMeal : 'snack'
    return { date: day, kind, name, amount, unit: kind === 'food' ? 'g' : 'ml', kcal_per_100: kcalPer100, duration_minutes: null, met: null, calories: caloriesForAmount(amount, kcalPer100), meal, not_in_health: false, note, source, recorded_by: actor }
  }
  const minutes = number(input.duration_minutes, 'duration_minutes', 1, 1_440)!
  const met = number(input.met, 'met', .5, 30, true)
  const weight = latestMeasurement(store.measurements, day)?.weight_kg || null
  const supplied = number(input.calories, 'calories', 0, 20_000, true)
  if (supplied === null && (met === null || weight === null)) throw new Error('exercise needs calories or a body weight and MET value')
  return { date: day, kind, name, amount: null, unit: null, kcal_per_100: null, duration_minutes: minutes, met, calories: supplied ?? exerciseCalories(weight!, minutes, met!), meal: null, not_in_health: input.not_in_health === true, note, source, recorded_by: actor }
}

export function saveEnergyEntry(input: Partial<EnergyEntry>, actor: EnergyActor): EnergyEntry {
  const now = new Date().toISOString()
  if (input.id) assertIdentifier(input.id, ENTRY_ID, 'energy entry id')
  let saved!: EnergyEntry
  updateJsonFile<EnergyStore>(ENERGY_FILE, { fallback: emptyStore, validate: validStore }, store => {
    const existing = input.id ? store.entries.find(item => item.id === input.id) : null
    if (input.id && !existing) throw new Error('energy entry not found')
    const clean = normalizeEntry(existing ? { ...existing, ...input } : input, existing?.recorded_by || actor, store)
    saved = existing
      ? { ...existing, ...clean, updated_at: now }
      : { ...clean, id: `energy_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, created_at: now, updated_at: null }
    return { ...store, entries: existing ? store.entries.map(item => item.id === existing.id ? saved : item) : [...store.entries, saved] }
  })
  return saved
}

export function deleteEnergyEntry(id: string): boolean {
  assertIdentifier(id, ENTRY_ID, 'energy entry id')
  let found = false
  updateJsonFile<EnergyStore>(ENERGY_FILE, { fallback: emptyStore, validate: validStore }, store => ({ ...store, entries: store.entries.filter(item => {
    if (item.id !== id) return true
    found = true
    return false
  }) }))
  return found
}

function summarizeDay(store: EnergyStore, day: string): EnergyDaySummary {
  const entries = store.entries.filter(item => item.date === day).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const foodKcal = entries.filter(item => item.kind === 'food').reduce((sum, item) => sum + item.calories, 0)
  const liquidEntries = entries.filter(item => item.kind === 'liquid')
  const liquidKcal = liquidEntries.reduce((sum, item) => sum + item.calories, 0)
  const liquidMl = liquidEntries.reduce((sum, item) => sum + (item.amount || 0), 0)
  const exerciseEntries = entries.filter(item => item.kind === 'exercise')
  const exerciseKcal = exerciseEntries.reduce((sum, item) => sum + item.calories, 0)
  const healthActive = readHealthDay(day)?.active_energy_kcal ?? null
  const measurement = latestMeasurement(store.measurements, day)
  const resting = measurement ? restingCalories(store.profile, measurement.weight_kg, day) : null
  const base = store.profile.manual_baseline_kcal ?? (resting === null ? null : healthActive === null ? Math.round(resting * 1.2) : resting)
  const countedExercise = healthActive === null
    ? exerciseKcal
    : exerciseEntries.filter(item => item.not_in_health).reduce((sum, item) => sum + item.calories, 0)
  const totalBurn = base === null ? null : Math.round(base + (healthActive || 0) + countedExercise)
  const intake = Math.round(foodKcal + liquidKcal)
  return {
    date: day, intake_kcal: intake, food_kcal: Math.round(foodKcal), liquid_kcal: Math.round(liquidKcal), liquid_ml: Math.round(liquidMl),
    exercise_kcal: Math.round(exerciseKcal), health_active_kcal: healthActive, total_burn_kcal: totalBurn,
    deficit_kcal: totalBurn === null ? null : totalBurn - intake, entries, measurement,
  }
}

export function readEnergyDashboard(day = madridDateKey(), dayCount = 7) {
  const target = date(day)
  const count = Math.max(1, Math.min(31, Math.round(dayCount)))
  const store = readStore()
  const days = Array.from({ length: count }, (_, index) => summarizeDay(store, addMadridDays(target, index - count + 1)))
  return {
    profile: store.profile,
    current_measurement: latestMeasurement(store.measurements, target),
    measurements: store.measurements.filter(item => item.date <= target).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 90),
    days,
    today: days[days.length - 1],
  }
}
