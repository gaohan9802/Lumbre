import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile } from '../json-file'
import { resolveDataPath } from '../safe-path'
import type { TravelCompanion, TravelPlaceResult, TravelVisit } from '@/lib/travel-map'

const VISITS_FILE = resolveDataPath(getDataDir(), 'travel-visits.json')
const GEOCODE_FILE = resolveDataPath(getDataDir(), 'travel-geocode-cache.json')
const DAY = /^\d{4}-\d{2}-\d{2}$/

function validDay(value: string): boolean {
  if (!DAY.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function isVisitList(value: unknown): boolean {
  return Array.isArray(value) && value.every(item => {
    const visit = item as Partial<TravelVisit> | null
    return !!visit && typeof visit.id === 'string' && typeof visit.place_id === 'string'
      && typeof visit.place_name === 'string' && typeof visit.address === 'string'
      && typeof visit.lat === 'number' && Number.isFinite(visit.lat) && visit.lat >= -90 && visit.lat <= 90
      && typeof visit.lon === 'number' && Number.isFinite(visit.lon) && visit.lon >= -180 && visit.lon <= 180
      && typeof visit.start_date === 'string' && validDay(visit.start_date)
      && (visit.end_date === null || (typeof visit.end_date === 'string' && validDay(visit.end_date)))
      && ['solo', 'star', 'other'].includes(String(visit.companion))
      && typeof visit.companion_name === 'string' && typeof visit.note === 'string'
      && (visit.album_id === null || typeof visit.album_id === 'string')
      && typeof visit.created_at === 'string' && (visit.updated_at === null || typeof visit.updated_at === 'string')
  })
}
function visits() {
  return readJsonFile<TravelVisit[]>(VISITS_FILE, { fallback: () => [], validate: isVisitList })
}
function cleanText(value: unknown, max: number): string {
  return String(value || '').trim().slice(0, max)
}
function normalizeVisit(input: Partial<TravelVisit>): Omit<TravelVisit, 'id' | 'created_at' | 'updated_at'> {
  const place_id = cleanText(input.place_id, 180)
  const place_name = cleanText(input.place_name, 100)
  const address = cleanText(input.address, 300)
  const lat = Number(input.lat)
  const lon = Number(input.lon)
  const start_date = cleanText(input.start_date, 10)
  const end_date = cleanText(input.end_date, 10) || null
  const companion = input.companion as TravelCompanion
  const companion_name = cleanText(input.companion_name, 80)
  if (!place_id || !place_name || !address) throw new Error('地点信息不完整')
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('地点坐标无效')
  if (!validDay(start_date) || (end_date && !validDay(end_date))) throw new Error('旅行日期无效')
  if (end_date && end_date < start_date) throw new Error('结束日期不能早于开始日期')
  if (!['solo', 'star', 'other'].includes(companion)) throw new Error('同行方式无效')
  if (companion === 'other' && !companion_name) throw new Error('请填写同行人的名字')
  return {
    place_id, place_name, address, lat, lon, start_date, end_date, companion,
    companion_name: companion === 'other' ? companion_name : '',
    note: cleanText(input.note, 500), album_id: cleanText(input.album_id, 128) || null,
  }
}

export function listTravelVisits(): TravelVisit[] {
  return visits().sort((a, b) => b.start_date.localeCompare(a.start_date) || b.created_at.localeCompare(a.created_at))
}

export function saveTravelVisit(input: Partial<TravelVisit>): TravelVisit {
  const clean = normalizeVisit(input)
  const now = new Date().toISOString()
  let saved: TravelVisit | null = null
  updateJsonFile<TravelVisit[]>(VISITS_FILE, { fallback: () => [], validate: isVisitList }, current => {
    if (input.id) {
      if (!current.some(visit => visit.id === input.id)) throw new Error('旅行记录不存在')
      return current.map(visit => {
        if (visit.id !== input.id) return visit
        saved = { ...visit, ...clean, updated_at: now }
        return saved
      })
    }
    saved = { ...clean, id: `trip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`, created_at: now, updated_at: null }
    return [...current, saved]
  })
  return saved!
}

export function deleteTravelVisit(id: string): boolean {
  let found = false
  updateJsonFile<TravelVisit[]>(VISITS_FILE, { fallback: () => [], validate: isVisitList }, current => current.filter(visit => {
    if (visit.id === id) found = true
    return visit.id !== id
  }))
  return found
}

interface GeocodeEntry { saved_at: string; results: TravelPlaceResult[] }
interface GeocodeState { last_request_at: number; entries: Record<string, GeocodeEntry> }
const emptyGeocode = (): GeocodeState => ({ last_request_at: 0, entries: {} })
const isGeocodeState = (value: unknown) => {
  const state = value as Partial<GeocodeState> | null
  return !!state && typeof state === 'object' && !Array.isArray(state)
    && typeof state.last_request_at === 'number' && !!state.entries
    && typeof state.entries === 'object' && !Array.isArray(state.entries)
}

export function readCachedTravelPlaces(query: string): TravelPlaceResult[] | null {
  const state = readJsonFile<GeocodeState>(GEOCODE_FILE, { fallback: emptyGeocode, fallbackOnInvalid: true, validate: isGeocodeState })
  return state.entries?.[query]?.results || null
}

export function claimTravelGeocode(now = Date.now()): boolean {
  let claimed = false
  updateJsonFile<GeocodeState>(GEOCODE_FILE, { fallback: emptyGeocode, fallbackOnInvalid: true, validate: isGeocodeState }, state => {
    if (now - Number(state.last_request_at || 0) < 1000) return state
    claimed = true
    return { ...state, last_request_at: now, entries: state.entries || {} }
  })
  return claimed
}

export function cacheTravelPlaces(query: string, results: TravelPlaceResult[]): void {
  updateJsonFile<GeocodeState>(GEOCODE_FILE, { fallback: emptyGeocode, fallbackOnInvalid: true, validate: isGeocodeState }, state => {
    const entries = { ...(state.entries || {}), [query]: { saved_at: new Date().toISOString(), results } }
    const bounded = Object.fromEntries(Object.entries(entries).sort((a, b) => b[1].saved_at.localeCompare(a[1].saved_at)).slice(0, 200))
    return { ...state, entries: bounded }
  })
}
