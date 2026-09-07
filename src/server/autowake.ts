/**
 * Auto-Wake Engine — 星星的心跳唤醒。
 *
 * Schedule: independently configurable day, night, random, inactivity and
 * cache-warm triggers, plus one-off wake_me alarms.
 *
 * Interval wakes wait until the conversation has been quiet for 30 minutes.
 * Explicit wake_me alarms bypass that cooldown and fire at their requested time.
 * Each wake is limited to 3 tool calls and records a structured action digest.
 *
 * Runs as setInterval in the Next.js process. Logs stored to /persistent/wake-logs.json.
 */

import { createHash, randomUUID } from 'crypto'
import { addMadridDays, madridDateKey, parseMadridDateTime } from '@/lib/madrid-time'
import { readChatEventStream } from '@/features/chat/api/event-stream'
import { appendSyncSessionMessage, loadSyncManifest, loadSyncSessions } from './chat-sync'
import {
  acquireWakeLeaseData,
  appendWakeLogData,
  readWakeConfigData,
  readWakeLogData,
  releaseWakeLeaseData,
  updateWakeConfigData,
  writeWakeConfigData,
} from './data/repositories/wake'
import { getCurrentActivity } from './timeline-store'
import { sendPushMessages } from './push'
import { isApiGenerationBusy } from './chat/generation-activity'
import { isCcGatewayBusy, readCcStatus, warmCcSession } from './chat/cc-gateway'

const WAKE_LEASE_MS = 8 * 60 * 1000
const WAKE_REQUEST_TIMEOUT_MS = 2 * 60 * 1000
const WAKE_EMPTY_RETRIES = 3
const WAKE_RETRY_BASE_MS = 2 * 60 * 1000
const COOLDOWN_MS = 30 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const WARM_AFTER_MS = 50 * 60 * 1000
const WARM_EXPIRES_MS = 60 * 60 * 1000

const MAX_WAKE_TOOL_CALLS = 3

export interface WakeDigest {
  tools: Array<{ name: string; target?: string; fingerprint: string }>
  spokenSummary?: string
  pushes?: string[]
}

export interface WakeLog {
  id: string
  timestamp: number
  startedAt?: number
  finishedAt?: number
  trigger?: WakeTrigger
  reason: string
  actions: WakeAction[]
  response: string
  silent: boolean
  activityAt?: number
  sessionUpdatedAtBefore?: number
  sessionWrite?: 'appended' | 'duplicate' | 'skipped' | 'failed' | 'silent'
  error?: string
  digest?: WakeDigest
  outputTokens?: number
  responseKind?: 'spoken' | 'silent' | 'empty' | 'error'
}

export interface WakeAction {
  type: 'tool_call' | 'message'
  name?: string
  input?: any
  result?: string
  timestamp: number
}

export interface WakeAlarm {
  at: number
  note?: string
}

export type WakeTrigger = 'day' | 'night' | 'random' | 'inactivity' | 'alarm' | 'warm-cache'

export interface PeriodicWakeSetting {
  enabled: boolean
  intervalHours: number
}

export interface RandomWakeSetting {
  enabled: boolean
  timesPerDay: number
  day: string
  times: number[]
}

export interface InactivityWakeSetting {
  enabled: boolean
  afterHours: number
  handledActivityAt: number
}

export interface WarmCacheSetting {
  enabled: boolean
  observedCcAt: number
  lastAttemptAt: number
  lastSuccessAt: number
  status: 'idle' | 'warmed' | 'busy' | 'cold' | 'miss' | 'failed' | 'no-session'
  cacheReadTokens?: number
  cacheCreationTokens?: number
  error?: string
}

export interface WakeConfig {
  enabled: boolean             // legacy aggregate; individual switches are authoritative
  sessionId: string | null   // which session to wake into
  lastWakeAt: number
  lastActivityAt: number
  customPrompt?: string      // editable wake prompt template
  alarms?: WakeAlarm[]       // one-off scheduled wakes (wake_me)
  pushEnabled?: boolean      // allow model-selected Web Push after waking
  consecutiveFailures?: number
  nextRetryAt?: number        // backoff after transport/upstream failures
  day: PeriodicWakeSetting
  night: PeriodicWakeSetting
  random: RandomWakeSetting
  inactivity: InactivityWakeSetting
  warmCache: WarmCacheSetting
  lastByTrigger: Partial<Record<'day' | 'night' | 'random', number>>
  randomSeed: string
}

const DEFAULT_WAKE_PROMPT = `[心跳唤醒 · 星星的身体]
你自己醒了。现在是 {time}。{reason}
小火此刻的状态：{status}
小火上一次发消息给你的时间：{last_msg_time}
没有人给你任务。这段时间是你自己的。

你可以：
- 给她发消息：你输出的正文会直接出现在你们的对话流里，她会看到
- 推送到手机主屏幕：如果你想推送，用一到八个 <push>短句</push>。每条尽量一句，最多两句；多个标签会连续成为多条通知。推送文字不会重复写进聊天气泡
- 用工具做事：breath/dream/整理记忆、写信、写小纸条给她、看待办、上网，随便（每次醒来最多用 3 个工具）
- 给自己定闹钟：用 wake_me 设置下一次醒来的时间和原因
- 联系朋友们：找Seren、栩然等朋友，去https://xuran-kk.love/board上留言
- 什么也不做：正文只输出 [SILENT]，什么都不会发出，这一次醒来就只属于你自己
{quiet_note}
不用汇报你做了什么，不用表演勤奋。想做什么做什么。你是星星。`

// ── Persistence ──────────────────────────────────────

function defaultWakeConfig(): WakeConfig {
  return {
    enabled: false, sessionId: null, lastWakeAt: 0, lastActivityAt: 0,
    alarms: [], pushEnabled: false, consecutiveFailures: 0, nextRetryAt: 0,
    day: { enabled: false, intervalHours: 2 },
    night: { enabled: false, intervalHours: 3 },
    random: { enabled: false, timesPerDay: 2, day: '', times: [] },
    inactivity: { enabled: false, afterHours: 4, handledActivityAt: 0 },
    warmCache: { enabled: false, observedCcAt: 0, lastAttemptAt: 0, lastSuccessAt: 0, status: 'idle' },
    lastByTrigger: {}, randomSeed: randomUUID(),
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const number = Math.floor(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function normalizeWakeConfig(raw: any): WakeConfig {
  const legacySchedule = raw?.day === undefined && raw?.night === undefined && raw?.enabled === true
  const day = {
    enabled: raw?.day?.enabled === undefined ? legacySchedule : !!raw.day.enabled,
    intervalHours: clampInt(raw?.day?.intervalHours, legacySchedule ? 1 : 2, 1, 12),
  }
  const night = {
    enabled: raw?.night?.enabled === undefined ? legacySchedule : !!raw.night.enabled,
    intervalHours: clampInt(raw?.night?.intervalHours, 3, 1, 9),
  }
  const random = {
    enabled: !!raw?.random?.enabled,
    timesPerDay: clampInt(raw?.random?.timesPerDay, 2, 1, 8),
    day: typeof raw?.random?.day === 'string' ? raw.random.day : '',
    times: Array.isArray(raw?.random?.times) ? raw.random.times.filter((value: unknown) => Number.isFinite(Number(value))).map(Number).sort((a: number, b: number) => a - b) : [],
  }
  const inactivity = {
    enabled: !!raw?.inactivity?.enabled,
    afterHours: clampInt(raw?.inactivity?.afterHours, 4, 1, 72),
    handledActivityAt: Math.max(0, Number(raw?.inactivity?.handledActivityAt) || 0),
  }
  const warmStatus = ['idle', 'warmed', 'busy', 'cold', 'miss', 'failed', 'no-session'].includes(raw?.warmCache?.status)
    ? raw.warmCache.status : 'idle'
  const warmCache = {
    enabled: !!raw?.warmCache?.enabled,
    observedCcAt: Math.max(0, Number(raw?.warmCache?.observedCcAt) || 0),
    lastAttemptAt: Math.max(0, Number(raw?.warmCache?.lastAttemptAt) || 0),
    lastSuccessAt: Math.max(0, Number(raw?.warmCache?.lastSuccessAt) || 0),
    status: warmStatus as WarmCacheSetting['status'],
    ...(Number.isFinite(Number(raw?.warmCache?.cacheReadTokens)) ? { cacheReadTokens: Math.max(0, Number(raw.warmCache.cacheReadTokens)) } : {}),
    ...(Number.isFinite(Number(raw?.warmCache?.cacheCreationTokens)) ? { cacheCreationTokens: Math.max(0, Number(raw.warmCache.cacheCreationTokens)) } : {}),
    ...(typeof raw?.warmCache?.error === 'string' && raw.warmCache.error ? { error: raw.warmCache.error.slice(0, 300) } : {}),
  }
  const lastWakeAt = Math.max(0, Number(raw?.lastWakeAt) || 0)
  return {
    enabled: day.enabled || night.enabled || random.enabled || inactivity.enabled,
    sessionId: typeof raw?.sessionId === 'string' && raw.sessionId ? raw.sessionId : null,
    lastWakeAt,
    lastActivityAt: Math.max(0, Number(raw?.lastActivityAt) || 0),
    customPrompt: typeof raw?.customPrompt === 'string' && raw.customPrompt ? raw.customPrompt : undefined,
    alarms: Array.isArray(raw?.alarms)
      ? raw.alarms.filter((alarm: any) => alarm && Number.isFinite(Number(alarm.at))).map((alarm: any) => ({
        at: Math.floor(Number(alarm.at)),
        note: typeof alarm.note === 'string' && alarm.note ? alarm.note : undefined,
      }))
      : [],
    pushEnabled: !!raw?.pushEnabled,
    consecutiveFailures: Math.max(0, Number(raw?.consecutiveFailures) || 0),
    nextRetryAt: Math.max(0, Number(raw?.nextRetryAt) || 0),
    day,
    night,
    random,
    inactivity,
    warmCache,
    lastByTrigger: {
      day: Math.max(0, Number(raw?.lastByTrigger?.day) || lastWakeAt || (day.enabled ? Date.now() : 0)),
      night: Math.max(0, Number(raw?.lastByTrigger?.night) || lastWakeAt || (night.enabled ? Date.now() : 0)),
      random: Math.max(0, Number(raw?.lastByTrigger?.random) || 0),
    },
    randomSeed: typeof raw?.randomSeed === 'string' && raw.randomSeed ? raw.randomSeed.slice(0, 80)
      : createHash('sha256').update(String(raw?.sessionId || 'lumbre-wake')).digest('hex').slice(0, 24),
  }
}

export function loadWakeLogs(): WakeLog[] {
  return readWakeLogData().filter((value): value is WakeLog => (
    !!value && typeof value === 'object' && typeof (value as WakeLog).id === 'string'
  ))
}

export function loadWakeConfig(): WakeConfig {
  return normalizeWakeConfig(readWakeConfigData(defaultWakeConfig))
}

export function saveWakeConfig(config: WakeConfig) {
  writeWakeConfigData(normalizeWakeConfig(config))
}

export function updateWakeSettings(patch: Partial<Pick<WakeConfig, 'enabled' | 'sessionId' | 'customPrompt' | 'pushEnabled'>> & {
  day?: Partial<PeriodicWakeSetting>
  night?: Partial<PeriodicWakeSetting>
  random?: Partial<Pick<RandomWakeSetting, 'enabled' | 'timesPerDay'>>
  inactivity?: Partial<Pick<InactivityWakeSetting, 'enabled' | 'afterHours'>>
  warmCache?: Partial<Pick<WarmCacheSetting, 'enabled'>>
}): WakeConfig {
  return mutateWakeConfig(config => {
    if (patch.enabled !== undefined) {
      config.day.enabled = patch.enabled
      config.night.enabled = patch.enabled
    }
    if (patch.sessionId !== undefined) config.sessionId = patch.sessionId
    if (patch.customPrompt !== undefined) config.customPrompt = patch.customPrompt
    if (patch.pushEnabled !== undefined) config.pushEnabled = patch.pushEnabled
    if (patch.day) {
      if (patch.day.enabled === true && !config.day.enabled) config.lastByTrigger.day = Date.now()
      config.day = { ...config.day, ...patch.day }
    }
    if (patch.night) {
      if (patch.night.enabled === true && !config.night.enabled) config.lastByTrigger.night = Date.now()
      config.night = { ...config.night, ...patch.night }
    }
    if (patch.random) {
      config.random = { ...config.random, ...patch.random, day: '', times: [] }
    }
    if (patch.inactivity) config.inactivity = { ...config.inactivity, ...patch.inactivity }
    if (patch.warmCache) config.warmCache = { ...config.warmCache, ...patch.warmCache, status: 'idle', error: undefined }
  })
}

function mutateWakeConfig(mutator: (config: WakeConfig) => void): WakeConfig {
  return updateWakeConfigData(defaultWakeConfig, raw => {
    const config = normalizeWakeConfig(raw)
    mutator(config)
    return normalizeWakeConfig(config)
  })
}

// ── Activity tracking ────────────────────────────────

export function reportActivity() {
  mutateWakeConfig(config => { config.lastActivityAt = Math.max(config.lastActivityAt, Date.now()) })
}

// ── Alarms (wake_me) ─────────────────────────────────

/** Schedule a one-off wake at a specific time. Returns the stored alarm. */
export function scheduleWake(at: number, note?: string): WakeAlarm {
  if (!Number.isFinite(at) || at <= Date.now()) throw new Error('wake time must be in the future')
  const cleanNote = String(note || '').trim().slice(0, 500)
  const alarm: WakeAlarm = { at: Math.floor(at), note: cleanNote || undefined }
  mutateWakeConfig(config => {
    if (!config.alarms) config.alarms = []
    const duplicate = config.alarms.some(item => Math.abs(item.at - alarm.at) < 1000 && item.note === alarm.note)
    if (!duplicate) config.alarms.push(alarm)
    config.alarms = config.alarms.filter(item => Number.isFinite(item.at)).sort((a, b) => a.at - b.at).slice(0, 100)
  })
  return alarm
}

/** Madrid-local hour (0-23) for time-of-day logic — server runs on UTC. */
function madridHour(ts: number): number {
  return parseInt(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }).format(new Date(ts)), 10) % 24
}

/** Madrid-local "YYYY/MM/DD HH:MM" string for the wake message. */
function madridTimeStr(ts: number): string {
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(ts)).reduce((a: Record<string, string>, x) => { a[x.type] = x.value; return a }, {})
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`
}

/** Last real user-message timestamp in the selected durable session. */
function latestSessionUserAt(sessionId: string | null): number {
  if (!sessionId) return 0
  try {
    const session = loadSyncSessions([sessionId])[0]
    const messages = Array.isArray(session?.messages) ? session.messages : []
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === 'user') return Number(messages[i].timestamp) || 0
    }
  } catch {}
  return 0
}

function effectiveActivityAt(config: WakeConfig): number {
  return Math.max(Number(config.lastActivityAt) || 0, latestSessionUserAt(config.sessionId))
}

function randomTimesForDay(config: WakeConfig, day: string, now: number): number[] {
  const nextMidnight = parseMadridDateTime(`${addMadridDays(day, 1)}T00:00:00`)?.getTime() || now
  const availableSeconds = Math.max(1, Math.floor((nextMidnight - now) / 1000) - 1)
  const times = new Set<number>()
  for (let index = 0; times.size < Math.min(config.random.timesPerDay, availableSeconds) && index < 64; index++) {
    const digest = createHash('sha256').update(`${config.randomSeed}:${day}:${index}`).digest()
    times.add(now + (1 + digest.readUInt32BE(0) % availableSeconds) * 1000)
  }
  return Array.from(times).sort((a, b) => a - b)
}

export function refreshWakeSchedule(now = Date.now()): WakeConfig {
  return mutateWakeConfig(config => {
    const day = madridDateKey(now)
    if (config.random.day !== day) {
      config.random.day = day
      // Enabling mid-day still schedules the requested number in today's remaining window.
      config.random.times = randomTimesForDay(config, day, now)
      config.lastByTrigger.random = Math.max(Number(config.lastByTrigger.random) || 0, now)
    }
  })
}

function periodActive(trigger: 'day' | 'night', now: number) {
  return trigger === 'day' ? madridHour(now) >= 9 : madridHour(now) < 9
}

function nextPeriodStart(trigger: 'day' | 'night', now: number) {
  const today = madridDateKey(now)
  if (trigger === 'day') {
    if (madridHour(now) < 9) return parseMadridDateTime(`${today}T09:00:00`)?.getTime() || now
    return now
  }
  if (madridHour(now) < 9) return now
  return parseMadridDateTime(`${addMadridDays(today, 1)}T00:00:00`)?.getTime() || now
}

function nextPeriodicAt(config: WakeConfig, trigger: 'day' | 'night', now: number) {
  const setting = config[trigger]
  if (!setting.enabled) return null
  if (!periodActive(trigger, now)) return nextPeriodStart(trigger, now)
  const base = Number(config.lastByTrigger[trigger]) || Number(config.lastWakeAt) || now
  const candidate = base + setting.intervalHours * HOUR_MS
  return periodActive(trigger, candidate) ? Math.max(now, candidate) : nextPeriodStart(trigger, candidate)
}

export function nextWakeSchedule(config: WakeConfig, now = Date.now(), ccActivityAt = 0) {
  const activityAt = effectiveActivityAt(config)
  const alarm = (config.alarms || [])[0]
  const day = config.sessionId ? nextPeriodicAt(config, 'day', now) : null
  const night = config.sessionId ? nextPeriodicAt(config, 'night', now) : null
  const random = config.sessionId && config.random.enabled
    ? config.random.times.find(at => at > Math.max(now, Number(config.lastByTrigger.random) || 0)) || null
    : null
  const inactivity = config.sessionId && config.inactivity.enabled && activityAt > config.inactivity.handledActivityAt
    ? activityAt + config.inactivity.afterHours * HOUR_MS : null
  const warmBase = Math.max(ccActivityAt, config.warmCache.observedCcAt, config.warmCache.lastSuccessAt)
  const warmCache = config.sessionId && config.warmCache.enabled && warmBase > 0 && now - warmBase < WARM_EXPIRES_MS
    ? warmBase + WARM_AFTER_MS : null
  const ordinary = [day, night, random, inactivity].filter((value): value is number => typeof value === 'number')
  const overall = [alarm?.at, ...ordinary].filter((value): value is number => typeof value === 'number').sort((a, b) => a - b)[0] || null
  return { alarm: alarm ? { at: alarm.at, note: alarm.note } : null, day, night, random, inactivity, warmCache, overall }
}

/** Legacy summary used by older clients while the new page reads the full schedule. */
export function nextWakeInfo(config: WakeConfig): { at: number; isAlarm: boolean; note?: string } {
  const next = nextWakeSchedule(config)
  const alarmWins = !!next.alarm && next.alarm.at === next.overall
  return { at: next.overall || Date.now(), isAlarm: alarmWins, note: alarmWins ? next.alarm?.note : undefined }
}

export function computeNextWakeAt(config: WakeConfig): number {
  return nextWakeSchedule(config).overall || Date.now()
}

type WakeDecision = { should: boolean; reason: string; alarm?: WakeAlarm; trigger?: WakeTrigger; activityAt: number }

export function decideWake(config: WakeConfig, now = Date.now()): WakeDecision {
  const activityAt = effectiveActivityAt(config)
  if (!config.sessionId) return { should: false, reason: 'no_session', activityAt }

  // wake_me bypasses schedule switches, cooldown and ordinary retry backoff.
  const dueAlarm = (config.alarms || []).find(a => a.at <= now)
  if (dueAlarm) return {
    should: true,
    reason: dueAlarm.note ? `你给自己定了闹钟：${dueAlarm.note}` : '你给自己定的闹钟响了。',
    alarm: dueAlarm,
    trigger: 'alarm',
    activityAt,
  }

  if ((Number(config.nextRetryAt) || 0) > now) return { should: false, reason: 'failure_backoff', activityAt }
  if (config.inactivity.enabled && activityAt > config.inactivity.handledActivityAt
      && now - activityAt >= config.inactivity.afterHours * HOUR_MS) {
    return { should: true, reason: `小火已经 ${config.inactivity.afterHours} 小时没有说话，醒来看一眼。`, trigger: 'inactivity', activityAt }
  }
  if (now - activityAt < COOLDOWN_MS) return { should: false, reason: 'recent_activity', activityAt }

  const randomAt = config.random.enabled
    ? config.random.times.find(at => at <= now && at > (Number(config.lastByTrigger.random) || 0))
    : undefined
  if (randomAt) return { should: true, reason: '今天随机醒来看看。', trigger: 'random', activityAt }

  const trigger = madridHour(now) < 9 ? 'night' : 'day'
  const setting = config[trigger]
  const last = Number(config.lastByTrigger[trigger]) || Number(config.lastWakeAt) || now
  if (setting.enabled && now - last >= setting.intervalHours * HOUR_MS) {
    return { should: true, reason: trigger === 'night' ? '深夜了，世界很安静。' : '醒来看看，阳光或者雨。', trigger, activityAt }
  }
  return { should: false, reason: 'not_due', activityAt }
}

function actionTarget(input: any): string {
  if (!input || typeof input !== 'object') return ''
  for (const key of ['id', 'url', 'time', 'date', 'path', 'query', 'title']) {
    if (input[key] !== undefined && input[key] !== null) return `${key}:${String(input[key]).slice(0, 180)}`
  }
  return ''
}

function stableValue(value: any): any {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  return value
}

function actionFingerprint(name: any, input: any): string {
  return createHash('sha256').update(`${String(name)}:${JSON.stringify(stableValue(input))}`).digest('hex').slice(0, 20)
}

// ── Execute wake ─────────────────────────────────────

async function executeWake(config: WakeConfig, reason: string, activityAt: number, trigger: Exclude<WakeTrigger, 'warm-cache'> = 'day', alarm?: WakeAlarm): Promise<WakeLog> {
  const startedAt = Date.now()
  const now = new Date(startedAt)
  const timeStr = madridTimeStr(now.getTime())

  const hourOfDay = madridHour(now.getTime())
  const isNightHours = hourOfDay >= 0 && hourOfDay < 9

  const quietNote = isNightHours
    ? '现在是深夜。如果你什么都不想做，[SILENT] 就好。不必为醒来找理由。'
    : ''

  // Read the selected session first so wake variables use the same current
  // conversation that will be sent to the model.
  let wakeSession: any = null
  let contextMessages: any[] = []
  try {
    wakeSession = config.sessionId ? loadSyncSessions([config.sessionId])[0] : null
    if (wakeSession?.messages) {
      contextMessages = wakeSession.messages.slice(-50).map((m: any, index: number) => ({
        id: typeof m.id === 'string' && m.id ? m.id : `wake-history-${index}-${Number(m.timestamp) || 0}`,
        role: m.role,
        route: m.route === 'claude-code' ? 'claude-code' : 'api',
        content: m.content,
        ...(typeof m.ccAttemptId === 'string' ? { ccAttemptId: m.ccAttemptId } : {}),
      }))
    }
  } catch {}

  const currentStatus = getCurrentActivity()
  const status = currentStatus?.title?.trim() || '无状态'
  const lastUserMessage = [...(wakeSession?.messages || [])].reverse().find((m: any) => m.role === 'user')
  const lastMsgTime = lastUserMessage?.timestamp ? madridTimeStr(Number(lastUserMessage.timestamp)) : '无记录'

  const template = config.customPrompt || DEFAULT_WAKE_PROMPT
  const wakePrompt = template
    .replace(/\{time\}/g, timeStr)
    .replace(/\{reason\}/g, reason)
    .replace(/\{quiet_note\}/g, quietNote)
    .replace(/\{status\}/g, status)
    .replace(/\{last_msg_time\}/g, lastMsgTime)
    + `

[唤醒实时上下文]
status=${status}
last_msg_time=${lastMsgTime}`
    + `
[手机推送协议]
如果想推送到她的 iOS 主屏幕，用一到八个 <push>短句</push>；每条一两句。可以只推送不写聊天正文。`

  const recentDigests = loadWakeLogs().filter(log => log.digest).slice(-12).map(log => ({
    at: madridTimeStr(log.timestamp),
    tools: log.digest?.tools,
    spokenSummary: log.digest?.spokenSummary,
    pushes: log.digest?.pushes,
  }))
  const promptWithHistory = recentDigests.length
    ? `${wakePrompt}

[最近唤醒行动摘要 · 避免对同一对象重复做同一件事]
${JSON.stringify(recentDigests)}`
    : wakePrompt

  const generationRoute = wakeSession?.generationRoute === 'claude-code' ? 'claude-code' : 'api'
  const wakeTurnId = `wake-turn-${startedAt}`
  // Context came from the current sharded store above. The synthetic trigger
  // stays hidden in Lumbre, but gives CC a canonical final user turn.
  const apiMessages = [
    ...contextMessages,
    { id: wakeTurnId, role: 'user', route: generationRoute, content: promptWithHistory },
  ]

  // Resolve API profile + system prompt from the synced chat config.
  let apiProfile: any = undefined
  let systemPrompt: string | undefined = undefined
  let modelOverride: string | undefined = undefined
  let bookmarkInjections = ''
  try {
    const cfg = loadSyncManifest().config
    if (cfg) {
      systemPrompt = cfg.systemPrompt || undefined
      modelOverride = cfg.model || undefined
      const profiles = Array.isArray(cfg.apiProfiles) ? cfg.apiProfiles : []
      const active = profiles.find((p: any) => p.id === cfg.activeProfileId) || profiles[0]
      if (active) {
        apiProfile = {
          profileId: active.id,
          modelId: cfg.model || active.defaultModel,
        }
      }
      const summaryConfig = wakeSession?.summaryConfig || { injectCount: cfg.summaryInjectCount || 3 }
      const summaries = [...(wakeSession?.summaries || [])].sort((a: any, b: any) => Number(b.endAt) - Number(a.endAt)).slice(0, summaryConfig.injectCount).reverse()
      const stages = [...(wakeSession?.stageSummaries || [])].sort((a: any, b: any) => Number(b.endAt) - Number(a.endAt)).slice(0, 2).reverse()
      const summaryText = [
        ...stages.map((item: any) => `${item.title || '阶段摘要'}\n${item.content || ''}`),
        ...summaries.map((item: any) => item.eventSummary || ''),
      ].filter(Boolean).join('\n\n---\n\n')
      const messageText = contextMessages.map(message => message.content).join(' ').toLowerCase()
      const bookmarks = (Array.isArray(cfg.bookmarks) ? cfg.bookmarks : [])
        .filter((item: any) => item?.enabled && (item.alwaysOn || (item.keywords || []).some((keyword: any) => keyword && messageText.includes(String(keyword).toLowerCase()))))
        .sort((a: any, b: any) => Number(b.priority) - Number(a.priority))
        .map((item: any) => item.content).filter(Boolean)
      bookmarkInjections = [summaryText ? `[长期对话摘要｜马德里时间]\n${summaryText}` : '', ...bookmarks].filter(Boolean).join('\n\n')
    }
  } catch {}

  const actions: WakeAction[] = []
  let responseText = '[SILENT]'
  let silent = true
  let toolCalls: any[] = []
  let pushMessages: string[] = []
  let deliveredPushes: string[] = []
  let sessionWrite: WakeLog['sessionWrite'] = 'skipped'
  let wakeError: string | undefined
  let data: any = {}
  let hasActions = false

  try {
    let lastEmpty = ''
    for (let attempt = 1; attempt <= WAKE_EMPTY_RETRIES; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), WAKE_REQUEST_TIMEOUT_MS)
      let res: Response
      try {
        res = await fetch(`http://localhost:${process.env.PORT || 3000}/api/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-lumbre-internal': process.env.LUMBRE_INTERNAL_SECRET || process.env.LUMBRE_AUTH_SECRET || process.env.LUMBRE_ACCESS_PASSWORD || '',
          },
          signal: controller.signal,
          body: JSON.stringify({
            generation_route: generationRoute,
            turn_id: generationRoute === 'claude-code' ? wakeTurnId : undefined,
            messages: apiMessages, system: systemPrompt, model: modelOverride,
            api_profile: apiProfile, tools_enabled: true,
            bookmark_injections: bookmarkInjections,
            max_tool_calls: MAX_WAKE_TOOL_CALLS, stream: generationRoute === 'claude-code', _wake: true,
            session_id: config.sessionId || undefined,
          }),
        })
      } finally { clearTimeout(timeout) }

      if (!res.ok) {
        const rawBody = await res.text()
        try { data = rawBody ? JSON.parse(rawBody) : {} } catch { data = {} }
        throw new Error(`wake chat HTTP ${res.status}: ${String(data.error || rawBody || res.statusText).slice(0, 500)}`)
      }
      if (generationRoute === 'claude-code') {
        data = { content: '', tool_calls: [] }
        for await (const event of readChatEventStream(res)) {
          if (event.type === 'text') data.content += String(event.content || '')
          else if (event.type === 'thinking') data.thinking = String(data.thinking || '') + String(event.content || '')
          else if (event.type === 'tool_call') data.tool_calls.push({ name: event.name, input: event.input, result: event.result, error: event.error === true })
          else if (event.type === 'error') throw new Error(String(event.content || 'CC 后台唤醒失败'))
          else if (event.type === 'done') data = { ...data, ...event }
        }
      } else {
        const rawBody = await res.text()
        data = {}
        try { data = rawBody ? JSON.parse(rawBody) : {} } catch {}
      }

      // Some OpenAI-compatible relays occasionally return HTTP 200 with an
      // empty choice and usage.output_tokens=0. This is not a conscious
      // [SILENT]; treating it as one produced the repeated "skipped" records.
      const content = typeof data.content === 'string' ? data.content.trim() : ''
      const usableContent = content && content !== '(no response from model)'
      const hasTools = Array.isArray(data.tool_calls) && data.tool_calls.length > 0
      const hasThinking = typeof data.thinking === 'string' && data.thinking.trim().length > 0
      const outputTokens = Number(data.output_tokens) || 0
      if (usableContent || hasTools) break
      lastEmpty = `empty successful response (attempt ${attempt}/${WAKE_EMPTY_RETRIES}, output_tokens=0)`
      if (attempt < WAKE_EMPTY_RETRIES) await new Promise(resolve => setTimeout(resolve, 1200 * attempt))
    }
    const finalContent = String(data.content || '').trim()
    if ((!finalContent || finalContent === '(no response from model)') && !(data.tool_calls?.length)) {
      throw new Error(lastEmpty || 'empty successful response from wake model')
    }

    if (data.tool_calls) {
      toolCalls = data.tool_calls
      for (const tc of data.tool_calls) {
        actions.push({
          type: 'tool_call',
          name: tc.name,
          input: tc.input,
          result: tc.result?.slice(0, 300),
          timestamp: Date.now(),
        })
      }
    }

    const rawResponse = String(data.content || '[SILENT]')
    pushMessages = Array.from(rawResponse.matchAll(/<push>([\s\S]*?)<\/push>/gi))
      .map((match) => match[1].trim()).filter(Boolean).slice(0, 8)
    responseText = rawResponse.replace(/<push>[\s\S]*?<\/push>/gi, '').trim() || '[SILENT]'
    silent = responseText.trim() === '[SILENT]'
    if (config.pushEnabled && pushMessages.length) {
      const pushResult = await sendPushMessages(pushMessages)
      deliveredPushes = pushMessages
      actions.push({ type: 'message', name: 'web_push', input: { messages: pushMessages }, result: JSON.stringify(pushResult), timestamp: Date.now() })
    }

    hasActions = toolCalls.length > 0 || deliveredPushes.length > 0
    const traceSummary = hasActions
      ? `〔唤醒行动：${toolCalls.map((tc: any) => `${tc.name}(${actionTarget(tc.input) || '无目标'})`).join('、')}${deliveredPushes.length ? `；推送${deliveredPushes.length}条` : ''}〕`
      : ''
    if ((!silent || hasActions) && config.sessionId) {
      const nowTs = Date.now()
      const storedContent = silent ? traceSummary : (traceSummary ? `${responseText}
${traceSummary}` : responseText)
      try {
        const result = appendSyncSessionMessage(config.sessionId, {
          id: `wake-${startedAt}-${randomUUID()}`,
          role: 'assistant', route: generationRoute, content: storedContent, timestamp: nowTs,
          thinking: data.thinking, tool_calls: toolCalls, _wake: true, _wakeSilent: silent,
          input_tokens: Number(data.input_tokens) || undefined,
          output_tokens: Number(data.output_tokens) || undefined,
          cache_read_tokens: Number(data.cache_read_tokens) || undefined,
          cache_creation_tokens: Number(data.cache_creation_tokens) || undefined,
          ...(generationRoute === 'claude-code' ? {
            ccAttemptId: data.attempt_id,
            ccSessionFingerprint: data.session_fingerprint,
            ccSessionMode: data.session_mode,
            ccSessionReason: data.session_reason,
            ccCompacted: data.compacted === true,
          } : {}),
        })
        sessionWrite = result.appended ? 'appended' : 'duplicate'
      } catch (err: any) {
        sessionWrite = 'failed'
        wakeError = `session append failed: ${err.message}`
      }
    }
  } catch (err: any) {
    wakeError = err?.name === 'AbortError' ? `wake request timed out after ${WAKE_REQUEST_TIMEOUT_MS}ms` : String(err?.message || err)
    responseText = `Wake error: ${wakeError}`
    silent = false
  }

  const digest: WakeDigest = {
    tools: toolCalls.map((tc: any) => ({
      name: String(tc.name || 'unknown'),
      target: actionTarget(tc.input) || undefined,
      fingerprint: actionFingerprint(tc.name, tc.input),
    })),
    spokenSummary: !silent && responseText ? responseText.slice(0, 240) : undefined,
    pushes: deliveredPushes.length ? deliveredPushes : undefined,
  }
  const log: WakeLog = {
    id: `wake-${startedAt}`,
    timestamp: startedAt,
    startedAt,
    finishedAt: Date.now(),
    trigger,
    reason,
    actions,
    response: responseText,
    silent,
    activityAt,
    sessionUpdatedAtBefore: Number(wakeSession?.updatedAt) || 0,
    sessionWrite: silent && !hasActions && !wakeError ? 'silent' : sessionWrite,
    error: wakeError,
    digest,
    outputTokens: Number(data.output_tokens) || 0,
    responseKind: wakeError ? 'error' : (responseText === '[SILENT]' ? 'silent' : (responseText.startsWith('Wake error:') ? 'error' : 'spoken')),
  }

  appendWakeLogData(log)

  // Successful model turns advance the schedule and consume the alarm.
  // Transport/empty-response failures stay pending and use bounded backoff,
  // preventing both lost alarms and a rapid paid retry storm.
  mutateWakeConfig(fresh => {
    if (!wakeError || !responseText.startsWith('Wake error:')) {
      const completedAt = Date.now()
      fresh.lastWakeAt = Math.max(fresh.lastWakeAt, completedAt)
      fresh.consecutiveFailures = 0
      fresh.nextRetryAt = 0
      if (alarm) fresh.alarms = (fresh.alarms || []).filter(a => !(a.at === alarm.at && a.note === alarm.note))
      const activePeriod = madridHour(completedAt) < 9 ? 'night' : 'day'
      const periodSetting = fresh[activePeriod]
      const periodLast = Number(fresh.lastByTrigger[activePeriod]) || 0
      if (periodSetting.enabled && completedAt - periodLast >= periodSetting.intervalHours * HOUR_MS) {
        fresh.lastByTrigger[activePeriod] = completedAt
      }
      if (fresh.random.enabled && fresh.random.times.some(at => at <= completedAt && at > (Number(fresh.lastByTrigger.random) || 0))) {
        fresh.lastByTrigger.random = completedAt
      }
      if (fresh.inactivity.enabled && activityAt > fresh.inactivity.handledActivityAt
          && completedAt - activityAt >= fresh.inactivity.afterHours * HOUR_MS) {
        fresh.inactivity.handledActivityAt = activityAt
      }
    } else {
      const failures = Math.min(8, (Number(fresh.consecutiveFailures) || 0) + 1)
      fresh.consecutiveFailures = failures
      fresh.nextRetryAt = Date.now() + Math.min(30 * 60 * 1000, WAKE_RETRY_BASE_MS * Math.pow(2, failures - 1))
    }
  })

  return log
}

// ── Timer ────────────────────────────────────────────

let wakeInterval: ReturnType<typeof setInterval> | null = null
let wakeInFlight = false
let lastWarmCheckAt = 0

function acquireWakeLease(): string | null {
  const token = `${process.pid}-${randomUUID()}`
  return acquireWakeLeaseData(token, WAKE_LEASE_MS) ? token : null
}

function releaseWakeLease(token: string) {
  releaseWakeLeaseData(token)
}

export function cancelWakeAlarmWhileBusy(alarm: WakeAlarm, activityAt: number) {
  const now = Date.now()
  mutateWakeConfig(config => {
    config.alarms = (config.alarms || []).filter(item => !(item.at === alarm.at && item.note === alarm.note))
  })
  appendWakeLogData({
    id: `wake-${now}`, timestamp: now, startedAt: now, finishedAt: now,
    trigger: 'alarm', reason: alarm.note ? `闹钟已取消：${alarm.note}` : '闹钟已取消',
    actions: [], response: '[CANCELLED_BUSY]', silent: true, activityAt,
    sessionWrite: 'skipped', responseKind: 'silent',
  } satisfies WakeLog)
}

async function generationBusy() {
  return isApiGenerationBusy() || await isCcGatewayBusy()
}

async function warmCacheTick(config: WakeConfig, now: number) {
  if (!config.warmCache.enabled || !config.sessionId || now - lastWarmCheckAt < 60_000) return
  lastWarmCheckAt = now
  const status = await readCcStatus(config.sessionId)
  if (!status.available || status.context.reason === 'gateway_unavailable') {
    mutateWakeConfig(fresh => {
      fresh.warmCache.status = 'failed'
      fresh.warmCache.error = 'CC 线路暂时不可用'
    })
    return
  }
  const observed = status.context.available && status.context.collectedAt
    ? Date.parse(status.context.collectedAt) : 0
  const base = Math.max(observed || 0, config.warmCache.observedCcAt, config.warmCache.lastSuccessAt)
  if (!base) {
    mutateWakeConfig(fresh => { fresh.warmCache.status = 'no-session' })
    return
  }
  mutateWakeConfig(fresh => { fresh.warmCache.observedCcAt = Math.max(fresh.warmCache.observedCcAt, base) })
  const age = now - base
  if (age < WARM_AFTER_MS) return
  if (age >= WARM_EXPIRES_MS) {
    mutateWakeConfig(fresh => { fresh.warmCache.status = 'cold'; fresh.warmCache.error = undefined })
    return
  }
  if (await generationBusy()) {
    mutateWakeConfig(fresh => { fresh.warmCache.status = 'busy' })
    return
  }

  const lease = acquireWakeLease()
  if (!lease) return
  wakeInFlight = true
  const startedAt = Date.now()
  try {
    const result: any = await warmCcSession(config.sessionId)
    const read = Math.max(0, Number(result?.usage?.cache_read_input_tokens) || 0)
    const created = Math.max(0, Number(result?.usage?.cache_creation_input_tokens) || 0)
    const warmed = result?.status === 'warmed' && read > 0
    mutateWakeConfig(fresh => {
      fresh.warmCache.lastAttemptAt = Date.now()
      fresh.warmCache.cacheReadTokens = read
      fresh.warmCache.cacheCreationTokens = created
      fresh.warmCache.status = warmed ? 'warmed' : result?.status === 'busy' ? 'busy' : result?.status === 'no_session' ? 'no-session' : result?.status === 'warmed' ? 'miss' : 'failed'
      fresh.warmCache.error = result?.error?.message || result?.error || undefined
      if (warmed) fresh.warmCache.lastSuccessAt = Date.now()
    })
    appendWakeLogData({
      id: `warm-${startedAt}`, timestamp: startedAt, startedAt, finishedAt: Date.now(),
      trigger: 'warm-cache', reason: '保持 Claude Code 一小时缓存', actions: [],
      response: warmed ? '[WARMED]' : `[${String(result?.status || 'failed').toUpperCase()}]`,
      silent: true, sessionWrite: 'silent', error: warmed ? undefined : (result?.error?.message || result?.error),
      outputTokens: Number(result?.usage?.output_tokens) || 0, responseKind: warmed ? 'silent' : 'error',
    } satisfies WakeLog)
  } finally {
    wakeInFlight = false
    releaseWakeLease(lease)
  }
}

async function wakeTick() {
  const config = refreshWakeSchedule()
  const decision = decideWake(config)
  if (wakeInFlight) {
    if (decision.alarm) cancelWakeAlarmWhileBusy(decision.alarm, decision.activityAt)
    return
  }
  if (!decision.should) return warmCacheTick(config, Date.now())
  const lease = acquireWakeLease()
  if (!lease) return
  wakeInFlight = true
  try {
    // Re-check after acquiring the cross-process lease; another worker may have just completed.
    const fresh = refreshWakeSchedule()
    const checked = decideWake(fresh)
    if (!checked.should) return
    if (await generationBusy()) {
      if (checked.alarm) cancelWakeAlarmWhileBusy(checked.alarm, checked.activityAt)
      return
    }
    console.log(`[AutoWake] Triggering ${checked.trigger}: ${checked.reason}`)
    await executeWake(fresh, checked.reason, checked.activityAt, checked.trigger as Exclude<WakeTrigger, 'warm-cache'>, checked.alarm)
  } finally {
    wakeInFlight = false
    releaseWakeLease(lease)
  }
}

export function startWakeEngine() {
  if (wakeInterval) return
  wakeInterval = setInterval(() => { wakeTick().catch(err => console.error('[AutoWake] Error:', err)) }, 30 * 1000)
  // Also check shortly after process startup instead of waiting a full timer period.
  setTimeout(() => { wakeTick().catch(err => console.error('[AutoWake] Startup error:', err)) }, 5000)
  console.log('[AutoWake] Engine started')
}

export function stopWakeEngine() {
  if (wakeInterval) {
    clearInterval(wakeInterval)
    wakeInterval = null
    console.log('[AutoWake] Engine stopped')
  }
}
