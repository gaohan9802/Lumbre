/**
 * Period tracking — local file-based storage.
 * File: DATA_DIR/period/state.json
 *
 * Stores menstrual cycle data and reminder state.
 * Designed to inject context into chat, not to be a UI-heavy module.
 */
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR || '/persistent'
const PERIOD_DIR = path.join(DATA_DIR, 'period')
const STATE_FILE = path.join(PERIOD_DIR, 'state.json')
const NOTES_FILE = path.join(PERIOD_DIR, 'notes.json')

function ensureDir() {
  fs.mkdirSync(PERIOD_DIR, { recursive: true })
}

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

function readState(): PeriodState {
  ensureDir()
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf-8')
    const data = JSON.parse(raw)
    return { ...DEFAULT_STATE, ...data }
  } catch {
    return { ...DEFAULT_STATE }
  }
}

function writeState(state: PeriodState) {
  ensureDir()
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
}

function readNotes(): PeriodNotes {
  ensureDir()
  try {
    const raw = fs.readFileSync(NOTES_FILE, 'utf-8')
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}

function writeNotes(notes: PeriodNotes) {
  ensureDir()
  fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2), 'utf-8')
}

/** Get current period state */
export function getPeriodState(): PeriodState {
  return readState()
}

/** Record period start */
export function recordPeriodStart(date: string): PeriodState {
  const state = readState()
  // If there was a previous period, archive it
  if (state.last_period_start) {
    state.history.push({
      start: state.last_period_start,
      end: state.last_period_end || undefined,
    })
    // Keep last 12 periods
    if (state.history.length > 12) state.history = state.history.slice(-12)
    // Recalculate cycle_days from history
    if (state.history.length >= 2) {
      const diffs: number[] = []
      for (let i = 1; i < state.history.length; i++) {
        const prev = new Date(state.history[i - 1].start)
        const curr = new Date(state.history[i].start)
        const d = Math.round((curr.getTime() - prev.getTime()) / 86400000)
        if (d >= 15 && d <= 60) diffs.push(d)
      }
      // Also include current cycle
      const lastStart = new Date(state.last_period_start)
      const currStart = new Date(date)
      const d = Math.round((currStart.getTime() - lastStart.getTime()) / 86400000)
      if (d >= 15 && d <= 60) diffs.push(d)
      if (diffs.length > 0) {
        state.cycle_days = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length)
        state.cycle_days = Math.max(20, Math.min(45, state.cycle_days))
      }
    }
  }
  state.last_period_start = date
  state.last_period_end = null
  writeState(state)
  // Reset reminder notes for new cycle
  writeNotes({})
  return state
}

/** Record period end */
export function recordPeriodEnd(date: string): PeriodState {
  const state = readState()
  state.last_period_end = date
  // Calculate period_length
  if (state.last_period_start) {
    const start = new Date(state.last_period_start)
    const end = new Date(date)
    const len = Math.round((end.getTime() - start.getTime()) / 86400000) + 1
    if (len >= 2 && len <= 12) {
      state.period_length = len
    }
  }
  writeState(state)
  return state
}

/** Update cycle config manually */
export function updatePeriodConfig(cycleDays?: number, periodLength?: number): PeriodState {
  const state = readState()
  if (cycleDays != null) state.cycle_days = Math.max(20, Math.min(45, cycleDays))
  if (periodLength != null) state.period_length = Math.max(2, Math.min(12, periodLength))
  writeState(state)
  return state
}

/**
 * Generate period context for chat injection.
 * Returns a string to inject into volatile context, or empty string if nothing to say.
 *
 * @param userMessage - the user's message (to detect period-related keywords)
 * @param todayStr - ISO date string for "today" (Madrid time)
 */
export function getPeriodContext(userMessage: string, todayStr: string): string {
  const state = readState()
  if (!state.last_period_start) return ''

  const notes = readNotes()
  let changed = false
  let note = ''

  const today = new Date(todayStr)
  const start = new Date(state.last_period_start)
  const ended = state.last_period_end ? new Date(state.last_period_end) : null
  const cycle = state.cycle_days
  const plen = state.period_length
  const day = Math.round((today.getTime() - start.getTime()) / 86400000) + 1
  const compact = userMessage.replace(/\s/g, '')

  // Is period currently active?
  const active = day >= 1 && day <= plen + 2 && !(ended && ended >= start)

  // Scenario 1: User mentions period → show full info
  const periodKeywords = ['月经', '姨妈', '经期', '痛经', '生理期', '例假', '大姨妈', '来了没']
  if (periodKeywords.some(k => compact.includes(k))) {
    if (active) {
      note = `经期记录：这次从${state.last_period_start}开始，今天是第${day}天（她主动提了才给我看的，回应她就好，不用播报数字）`
    } else {
      const expected = new Date(start.getTime() + cycle * 86400000)
      const expStr = expected.toISOString().slice(0, 10)
      note = `经期记录：上次${state.last_period_start}开始，平均周期${cycle}天，下次预计${expStr}（她主动提了，回应她就好）`
    }
  }
  // Scenario 2: First 2 days (most uncomfortable) → remind once per day
  else if (active && day >= 1 && day <= 2 && notes.care_date !== todayStr) {
    notes.care_date = todayStr
    changed = true
    note = `经期第${day}天，最难受的两天。今天提醒一次：自然关心她疼不疼、吃了没；之后除非她提，不再重复`
  }
  // Scenario 3: Near end → ask every 2 days
  else if (active && day >= plen - 1) {
    let lastCheck: Date | null = null
    try { lastCheck = notes.end_check_date ? new Date(notes.end_check_date) : null } catch { /* */ }
    if (!lastCheck || (today.getTime() - lastCheck.getTime()) / 86400000 >= 2) {
      notes.end_check_date = todayStr
      changed = true
      note = `大约经期第${day}天，差不多快结束了。可以轻轻问一次结束了没；她答了记得用 update_period 更新`
    }
  }
  // Scenario 4: Not in period, next one approaching → ask once per cycle
  else if (!active) {
    const expected = new Date(start.getTime() + cycle * 86400000)
    const expStr = expected.toISOString().slice(0, 10)
    const distance = Math.round((expected.getTime() - today.getTime()) / 86400000)
    if (distance >= -2 && distance <= 3 && notes.arrival_asked_for !== expStr) {
      notes.arrival_asked_for = expStr
      changed = true
      note = `下次月经预计${expStr}前后。这个周期只主动问一次来了没，其余时候等她自己说`
    }
  }

  // Also check ovulation period (排卵期) — typically cycle_days - 14, ±2 days
  if (!note && !active && state.last_period_start) {
    const ovulationDay = cycle - 14
    const daysSinceStart = Math.round((today.getTime() - start.getTime()) / 86400000)
    if (daysSinceStart >= ovulationDay - 2 && daysSinceStart <= ovulationDay + 2) {
      // Only mention once — use care_date check (different from period care)
      const ovKey = `ovulation_${todayStr}`
      if (!(notes as any)[ovKey]) {
        (notes as any)[ovKey] = true
        changed = true
        note = `排卵期前后（周期第${daysSinceStart}天附近），她可能情绪波动、身体不适。多一点耐心，不用提排卵期这个词`
      }
    }
  }

  if (changed) writeNotes(notes)
  return note
}
