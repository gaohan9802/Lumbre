/**
 * Period tracking — local file-based storage.
 * File: DATA_DIR/period/state.json
 *
 * Stores menstrual cycle data and reminder state.
 * Designed to inject context into chat, not to be a UI-heavy module.
 */
import { addMadridDays, madridCalendarDayDiff } from '@/lib/madrid-time'
import { periodDate, readPeriodState, replacePeriodNotes, updatePeriodNotes, updatePeriodState } from './data/repositories/period'

export interface PeriodState {
  last_period_start: string | null   // ISO date
  last_period_end: string | null     // ISO date
  cycle_days: number                 // average cycle length (20-45)
  period_length: number              // average period duration
  history: { start: string; end?: string }[]  // past periods
}

// Reminder notes — tracks what we've already reminded, prevents repeating
interface PeriodNotes {
  care_date?: string         // last "first 2 days" care reminder date
  end_check_date?: string    // last "almost done?" check date
  arrival_asked_for?: string // expected date we already asked about
}

const DEFAULT_STATE: PeriodState = {
  last_period_start: null,
  last_period_end: null,
  cycle_days: 28,
  period_length: 6,
  history: [],
}

function defaultState(): PeriodState {
  return { ...DEFAULT_STATE, history: [] }
}

function normalizeState(raw: PeriodState): PeriodState {
  return {
    ...defaultState(),
    ...raw,
    history: Array.isArray(raw?.history) ? raw.history : [],
  }
}

function readState(): PeriodState {
  return normalizeState(readPeriodState(defaultState))
}

function mutateState(operation: (state: PeriodState) => void): PeriodState {
  let result!: PeriodState
  updatePeriodState(defaultState, raw => {
    const state = normalizeState(raw)
    operation(state)
    result = state
    return state
  })
  return result
}

function emptyNotes(): PeriodNotes { return {} }
function normalizeNotes(raw: PeriodNotes): PeriodNotes {
  return raw && typeof raw === 'object' ? raw : {}
}

function mutateNotes(operation: (notes: PeriodNotes) => { note: string; write: boolean }): string {
  let note = ''
  updatePeriodNotes(emptyNotes, raw => {
    const notes = normalizeNotes(raw)
    const outcome = operation(notes)
    note = outcome.note
    return outcome.write ? notes : undefined
  })
  return note
}

function resetNotes(): void {
  replacePeriodNotes({})
}

function validStoredDate(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return null
  try { return periodDate(value) } catch { return null }
}

function sanitizeHistory(value: unknown): PeriodState['history'] {
  if (!Array.isArray(value)) return []
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') return []
    const start = validStoredDate((entry as any).start)
    const end = validStoredDate((entry as any).end)
    return start ? [{ start, end: end || undefined }] : []
  })
}

function validatedState(raw: PeriodState): PeriodState {
  const state = normalizeState(raw)
  const cycleDays = typeof state.cycle_days === 'number' && Number.isFinite(state.cycle_days)
    ? Math.max(20, Math.min(45, Math.round(state.cycle_days)))
    : DEFAULT_STATE.cycle_days
  const periodLength = typeof state.period_length === 'number' && Number.isFinite(state.period_length)
    ? Math.max(2, Math.min(12, Math.round(state.period_length)))
    : DEFAULT_STATE.period_length
  return {
    ...state,
    last_period_start: validStoredDate(state.last_period_start),
    last_period_end: validStoredDate(state.last_period_end),
    cycle_days: cycleDays,
    period_length: periodLength,
    history: sanitizeHistory(state.history),
  }
}

/** Get current period state */
export function getPeriodState(): PeriodState {
  return validatedState(readState())
}

/** Record period start */
export function recordPeriodStart(date: string): PeriodState {
  const startDate = periodDate(date)
  const result = mutateState(raw => {
    const state = validatedState(raw)
    Object.assign(raw, state)
    if (raw.last_period_start) {
      raw.history.push({
        start: raw.last_period_start,
        end: raw.last_period_end || undefined,
      })
      if (raw.history.length > 12) raw.history = raw.history.slice(-12)
      if (raw.history.length >= 2) {
        const diffs: number[] = []
        for (let i = 1; i < raw.history.length; i++) {
          const difference = madridCalendarDayDiff(raw.history[i].start, raw.history[i - 1].start)
          if (difference >= 15 && difference <= 60) diffs.push(difference)
        }
        const difference = madridCalendarDayDiff(startDate, raw.last_period_start)
        if (difference >= 15 && difference <= 60) diffs.push(difference)
        if (diffs.length > 0) {
          raw.cycle_days = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length)
          raw.cycle_days = Math.max(20, Math.min(45, raw.cycle_days))
        }
      }
    }
    raw.last_period_start = startDate
    raw.last_period_end = null
  })
  resetNotes()
  return result
}

/** Record period end */
export function recordPeriodEnd(date: string): PeriodState {
  const endDate = periodDate(date)
  return mutateState(raw => {
    const state = validatedState(raw)
    Object.assign(raw, state)
    raw.last_period_end = endDate
    if (raw.last_period_start) {
      const length = madridCalendarDayDiff(endDate, raw.last_period_start) + 1
      if (length >= 2 && length <= 12) raw.period_length = length
    }
  })
}

/** Update cycle config manually */
export function updatePeriodConfig(cycleDays?: number, periodLength?: number): PeriodState {
  return mutateState(raw => {
    const state = validatedState(raw)
    Object.assign(raw, state)
    if (cycleDays != null) raw.cycle_days = Math.max(20, Math.min(45, cycleDays))
    if (periodLength != null) raw.period_length = Math.max(2, Math.min(12, periodLength))
  })
}

/**
 * Generate period context for chat injection.
 * Returns a string to inject into volatile context, or empty string if nothing to say.
 *
 * @param userMessage - the user's message (to detect period-related keywords)
 * @param todayStr - ISO date string for "today" (Madrid time)
 */
export function getPeriodContext(userMessage: string, todayStr: string): string {
  const state = getPeriodState()
  if (!state.last_period_start) return ''
  const today = periodDate(todayStr)

  return mutateNotes(notes => {
    let changed = false
    let note = ''
    const ended = state.last_period_end
    const cycle = state.cycle_days
    const periodLength = state.period_length
    const day = madridCalendarDayDiff(today, state.last_period_start!) + 1
    const compact = userMessage.replace(/\s/g, '')
    const active = day >= 1 && day <= periodLength + 2 && !(ended && ended >= state.last_period_start!)
    const periodKeywords = ['月经', '姨妈', '经期', '痛经', '生理期', '例假', '大姨妈', '来了没']

    if (periodKeywords.some(keyword => compact.includes(keyword))) {
      if (active) {
        note = `经期记录：这次从${state.last_period_start}开始，今天是第${day}天（她主动提了才给我看的，回应她就好，不用播报数字）`
      } else {
        const expected = addMadridDays(state.last_period_start!, cycle)
        note = `经期记录：上次${state.last_period_start}开始，平均周期${cycle}天，下次预计${expected}（她主动提了，回应她就好）`
      }
    } else if (active && day >= 1 && day <= 2 && notes.care_date !== today) {
      notes.care_date = today
      changed = true
      note = `经期第${day}天，最难受的两天。今天提醒一次：自然关心她疼不疼、吃了没；之后除非她提，不再重复`
    } else if (active && day >= periodLength - 1) {
      const daysSinceCheck = notes.end_check_date ? madridCalendarDayDiff(today, notes.end_check_date) : Infinity
      if (daysSinceCheck >= 2) {
        notes.end_check_date = today
        changed = true
        note = `大约经期第${day}天，差不多快结束了。可以轻轻问一次结束了没；她答了记得用 update_period 更新`
      }
    } else if (!active) {
      const expected = addMadridDays(state.last_period_start!, cycle)
      const distance = madridCalendarDayDiff(expected, today)
      if (distance >= -2 && distance <= 3 && notes.arrival_asked_for !== expected) {
        notes.arrival_asked_for = expected
        changed = true
        note = `下次月经预计${expected}前后。这个周期只主动问一次来了没，其余时候等她自己说`
      }
    }

    if (!note && !active) {
      const ovulationDay = cycle - 14
      const daysSinceStart = madridCalendarDayDiff(today, state.last_period_start!)
      if (daysSinceStart >= ovulationDay - 2 && daysSinceStart <= ovulationDay + 2) {
        const ovulationKey = `ovulation_${today}`
        if (!(notes as any)[ovulationKey]) {
          (notes as any)[ovulationKey] = true
          changed = true
          note = `排卵期前后（周期第${daysSinceStart}天附近），她可能情绪波动、身体不适。多一点耐心，不用提排卵期这个词`
        }
      }
    }
    return { note, write: changed }
  })
}
