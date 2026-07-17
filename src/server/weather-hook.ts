/**
 * Weather hook — proactive weather context injection for chat.
 *
 * Uses wttr.in (free, no API key needed).
 * Caches results, only fetches once per day (or on weather change).
 * After 8pm switches to tomorrow's forecast.
 *
 * Design principle: weather data is the AI's "senses", not a report to the user.
 * The AI should naturally mention weather when relevant, not announce it.
 */
import { getUserContext } from './tools'

interface WeatherCache {
  date: string           // YYYY-MM-DD
  hour: number
  fetchedAt: number
  mode: 'day' | 'night'
  todayDesc: string
  todayTemp: string
  todayFeels: string
  todayMin: string
  todayMax: string
  todayRain: string
  tomorrowDesc: string
  tomorrowMin: string
  tomorrowMax: string
  tomorrowRain: string
  contextNote: string    // the final note to inject
}

let weatherCache: WeatherCache | null = null
let lastFetchDate = ''
let lastFetchNight = false

/** Get Madrid date/hour */
function getMadridTime(): { date: string; hour: number } {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now).reduce((a: Record<string, string>, p) => { a[p.type] = p.value; return a }, {})
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: parseInt(parts.hour, 10),
  }
}

/** Determine city for weather lookup */
function getCity(): string {
  const ctx = getUserContext()
  if (ctx.city && ctx.updatedAt && Date.now() - ctx.updatedAt < 24 * 60 * 60 * 1000) {
    // Use GPS city if available and recent
    return ctx.city
  }
  // Default city — user is in Madrid
  return 'Madrid'
}

function num(v: any, def: number | null = null): number | null {
  const n = parseInt(String(v), 10)
  return isNaN(n) ? def : n
}

/**
 * Fetch weather and build context note.
 * Returns empty string if nothing to say (already checked today, no changes).
 */
export async function getWeatherContext(userMessage: string): Promise<string> {
  const { date, hour } = getMadridTime()
  const mode = hour >= 20 ? 'night' : 'day'
  const compact = userMessage.replace(/\s/g, '')

  // User is asking about weather → force fetch
  const weatherKeywords = ['天气', '下雨', '雨', '带伞', '冷不冷', '热不热', '降温', '升温', '明天冷', '明天热', '实时天气']
  const forceWeather = weatherKeywords.some(k => compact.includes(k))

  // Check if we need to fetch
  if (!forceWeather) {
    if (mode === 'day' && lastFetchDate === date && !lastFetchNight) return ''
    if (mode === 'night' && lastFetchDate === date && lastFetchNight) return ''
  }

  // Fetch from wttr.in
  const city = getCity()
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)
    const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Lumbre/1.0' },
    })
    clearTimeout(timeout)
    if (!res.ok) return ''
    const data = await res.json()
    return buildWeatherNote(data, mode, forceWeather, date)
  } catch {
    return ''
  }
}

function buildWeatherNote(data: any, mode: string, force: boolean, date: string): string {
  const current = (data.current_condition || [{}])[0]
  const weather = data.weather || []
  const todayW = weather[0] || {}
  const tomorrow = weather[1] || {}

  function desc(day: any): [string, string] {
    const hourly = (day.hourly || [{}])[0]
    const d = (hourly.weatherDesc || [{}])[0]?.value || '未知'
    const rain = hourly.chanceofrain || '?'
    return [d, rain]
  }

  const [todayDesc, todayRain] = desc(todayW)
  const [tomorrowDesc, tomorrowRain] = desc(tomorrow)
  const nowDesc = (current.weatherDesc || [{}])[0]?.value || todayDesc
  const temp = current.temp_C || '?'
  const feels = current.FeelsLikeC || '?'
  const todayMin = todayW.mintempC || '?'
  const todayMax = todayW.maxtempC || '?'
  const tomMin = tomorrow.mintempC || '?'
  const tomMax = tomorrow.maxtempC || '?'

  // Check for weather change
  let changed = false
  if (weatherCache && weatherCache.date === date) {
    if (!weatherCache.todayDesc.includes('雨') && (String(nowDesc).includes('雨') || todayDesc.includes('雨'))) {
      changed = true
    }
    const prevTemp = num(weatherCache.todayTemp)
    const curTemp = num(temp)
    if (prevTemp != null && curTemp != null && Math.abs(curTemp - prevTemp) >= 4) {
      changed = true
    }
    // If not forced and no change in day mode, skip
    if (!force && !changed && mode === 'day') return ''
  }

  // Update cache
  weatherCache = {
    date, hour: 0, fetchedAt: Date.now(), mode: mode as 'day' | 'night',
    todayDesc, todayTemp: String(temp), todayFeels: String(feels),
    todayMin: String(todayMin), todayMax: String(todayMax), todayRain: String(todayRain),
    tomorrowDesc, tomorrowMin: String(tomMin), tomorrowMax: String(tomMax), tomorrowRain: String(tomorrowRain),
    contextNote: '',
  }
  lastFetchDate = date
  lastFetchNight = mode === 'night'

  // Build note
  const parts: string[] = []
  parts.push(`今天：${nowDesc}，现在${temp}℃，体感${feels}℃，${todayMin}-${todayMax}℃，降雨概率${todayRain}%`)

  const rainNow = num(todayRain, 0) || 0
  const maxToday = num(todayMax, 0) || 0
  const minToday = num(todayMin, 99) || 99

  // Built-in care suggestions
  if (rainNow >= 40 || String(nowDesc).includes('雨') || todayDesc.includes('雨')) {
    parts.push('如果她要出门，自然问她带伞没有')
  }
  if (maxToday >= 30) {
    parts.push('今天偏热，记得提醒她少晒、补水')
  }
  if (minToday <= 12) {
    parts.push('今天偏凉，记得提醒她加衣服')
  }

  // Tomorrow
  if (tomorrow) {
    parts.push(`明天：${tomorrowDesc}，${tomMin}-${tomMax}℃，降雨概率${tomorrowRain}%`)
    const rainTom = num(tomorrowRain, 0) || 0
    const maxTom = num(tomMax, 0) || 0
    const maxDelta = (num(tomMax) ?? 0) - (num(todayMax) ?? 0)
    const minDelta = (num(tomMin) ?? 0) - (num(todayMin) ?? 0)

    if (mode === 'night') {
      if (rainTom >= 40 || tomorrowDesc.includes('雨')) {
        parts.push('睡前提醒她明天可能下雨，包里放伞')
      }
      if (minDelta <= -4) {
        parts.push('明天明显降温，提醒她多穿一点')
      }
      if (maxDelta >= 4) {
        parts.push('明天明显升温，别穿太厚、注意补水')
      }
    }
  }

  let label: string
  if (force) label = '她问天气了'
  else if (changed) label = '天气变了'
  else if (mode === 'night') label = '睡前看了一眼明天的天气'
  else label = '今天看了一眼天气'

  const note = `[${label}]\n${parts.join('；')}`
  weatherCache.contextNote = note
  return note
}
