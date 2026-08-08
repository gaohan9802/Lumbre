/** Canonical app timezone helpers. Storage stays UTC epoch/ISO; display and naive input use Europe/Madrid. */
export const APP_TIME_ZONE = 'Europe/Madrid'

function partsAt(value: Date | number | string) {
  const date = value instanceof Date ? value : new Date(value)
  const out: Record<string, number> = {}
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date)) if (p.type !== 'literal') out[p.type] = Number(p.value)
  if (out.hour === 24) out.hour = 0
  return out
}

export function madridDateKey(value: Date | number | string = new Date()): string {
  const p = partsAt(value)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function formatMadrid(value: Date | number | string, seconds = true): string {
  const p = partsAt(value)
  return `${p.year}/${String(p.month).padStart(2, '0')}/${String(p.day).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}${seconds ? `:${String(p.second).padStart(2, '0')}` : ''}`
}

export function formatMadridInput(value: Date | number | string): string {
  const p = partsAt(value)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}T${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`
}

export function formatMadridShort(value: Date | number | string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: APP_TIME_ZONE, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value))
}

/** Parse ISO with offset normally; interpret offset-less YYYY-MM-DDTHH:mm as Madrid wall time (DST-safe). */
export function parseMadridDateTime(value: unknown): Date | null {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value
  const raw = String(value || '').trim()
  if (!raw) return null
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const d = new Date(raw)
    return isNaN(d.getTime()) ? null : d
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2})(?::(\d{2}))?(?::(\d{2}))?)?$/.exec(raw)
  if (!m) { const d = new Date(raw); return isNaN(d.getTime()) ? null : d }
  const target = { year: +m[1], month: +m[2], day: +m[3], hour: +(m[4] || 0), minute: +(m[5] || 0), second: +(m[6] || 0) }
  let guess = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second)
  for (let i = 0; i < 3; i++) {
    const p = partsAt(guess)
    const represented = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
    const wanted = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, target.second)
    guess += wanted - represented
  }
  const result = new Date(guess)
  if (isNaN(result.getTime())) return null
  // Madrid's spring DST jump contains wall times that never exist (for example 02:30).
  // Reject them instead of silently moving the user's input by an hour.
  const final = partsAt(result)
  if (final.year !== target.year || final.month !== target.month || final.day !== target.day || final.hour !== target.hour || final.minute !== target.minute || final.second !== target.second) return null
  return result
}

export function madridDayBounds(day: string, days = 1): [string, string] {
  const start = parseMadridDateTime(`${day}T00:00:00`)
  if (!start) throw new Error('Invalid Madrid date')
  const [y, m, d] = day.split('-').map(Number)
  const endDayDate = new Date(Date.UTC(y, m - 1, d + days))
  const endDay = `${endDayDate.getUTCFullYear()}-${String(endDayDate.getUTCMonth() + 1).padStart(2, '0')}-${String(endDayDate.getUTCDate()).padStart(2, '0')}`
  const end = parseMadridDateTime(`${endDay}T00:00:00`)
  if (!end) throw new Error('Invalid Madrid date')
  return [start.toISOString(), end.toISOString()]
}

/** Add calendar days to a Madrid YYYY-MM-DD key without depending on the host timezone. */
export function addMadridDays(day: string, amount: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const shifted = new Date(Date.UTC(y, m - 1, d + amount))
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`
}

export function madridIsoWeekday(value: Date | number | string): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone: APP_TIME_ZONE, weekday: 'short' }).format(new Date(value))
  return ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as Record<string, number>)[short] || 1
}

export function madridCalendarDayDiff(laterDay: string, earlierDay: string): number {
  const [ly, lm, ld] = laterDay.split('-').map(Number)
  const [ey, em, ed] = earlierDay.split('-').map(Number)
  return Math.round((Date.UTC(ly, lm - 1, ld) - Date.UTC(ey, em - 1, ed)) / 86400000)
}
