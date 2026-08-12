/**
 * Auto-Wake Engine — 星星的心跳唤醒。
 *
 * Schedule:
 *  - 09:00–00:00: every 1 hour
 *  - 00:00–09:00: every 3 hours
 *  - one-off alarms (wake_me) become due at their scheduled time.
 *
 * All wakes, including alarms, wait until the conversation has been quiet for
 * 30 minutes. Due alarms stay pending and fire after cooldown instead of being lost.
 * Each wake is limited to 3 tool calls and records a structured action digest.
 *
 * Runs as setInterval in the Next.js process. Logs stored to /persistent/wake-logs.json.
 */

import * as fs from 'fs'
import * as path from 'path'
import { createHash, randomUUID } from 'crypto'
import { appendSyncSessionMessage, loadSyncManifest, loadSyncSessions } from './chat-sync'
import { getCurrentActivity } from './timeline-store'
import { sendPushMessages } from './push'

const PERSISTENT = '/persistent'
const WAKE_LOG_PATH = path.join(PERSISTENT, 'wake-logs.json')
const WAKE_CONFIG_PATH = path.join(PERSISTENT, 'wake-config.json')
const WAKE_CONFIG_LOCK = path.join(PERSISTENT, '.wake-config-lock')
const WAKE_LEASE_DIR = path.join(PERSISTENT, '.wake-engine-lease')
const WAKE_LEASE_MS = 5 * 60 * 1000
const WAKE_REQUEST_TIMEOUT_MS = 2 * 60 * 1000
const COOLDOWN_MS = 30 * 60 * 1000

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
  trigger?: 'interval' | 'alarm'
  reason: string
  actions: WakeAction[]
  response: string
  silent: boolean
  activityAt?: number
  sessionUpdatedAtBefore?: number
  sessionWrite?: 'appended' | 'duplicate' | 'skipped' | 'failed'
  error?: string
  digest?: WakeDigest
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

export interface WakeConfig {
  enabled: boolean
  sessionId: string | null   // which session to wake into
  lastWakeAt: number
  lastActivityAt: number
  customPrompt?: string      // editable wake prompt template
  alarms?: WakeAlarm[]       // one-off scheduled wakes (wake_me)
  pushEnabled?: boolean      // allow model-selected Web Push after waking
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

function ensureDir() {
  try { fs.mkdirSync(PERSISTENT, { recursive: true }) } catch {}
}

function atomicWrite(file: string, value: string) {
  ensureDir()
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, value, 'utf-8')
  fs.renameSync(tmp, file)
}

function withConfigLock<T>(fn: () => T): T {
  ensureDir()
  const deadline = Date.now() + 3000
  while (true) {
    try { fs.mkdirSync(WAKE_CONFIG_LOCK); break } catch {
      try {
        if (Date.now() - fs.statSync(WAKE_CONFIG_LOCK).mtimeMs > 15_000) {
          fs.rmSync(WAKE_CONFIG_LOCK, { recursive: true, force: true }); continue
        }
      } catch {}
      if (Date.now() >= deadline) throw new Error('wake config lock timeout')
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
    }
  }
  try { return fn() } finally { try { fs.rmSync(WAKE_CONFIG_LOCK, { recursive: true, force: true }) } catch {} }
}

export function loadWakeLogs(): WakeLog[] {
  try {
    return JSON.parse(fs.readFileSync(WAKE_LOG_PATH, 'utf-8'))
  } catch {
    return []
  }
}

function saveWakeLogs(logs: WakeLog[]) {
  ensureDir()
  const trimmed = logs.slice(-200)
  atomicWrite(WAKE_LOG_PATH, JSON.stringify(trimmed, null, 2))
}

export function loadWakeConfig(): WakeConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(WAKE_CONFIG_PATH, 'utf-8'))
    return {
      enabled: !!raw.enabled,
      sessionId: raw.sessionId || null,
      lastWakeAt: raw.lastWakeAt || 0,
      lastActivityAt: raw.lastActivityAt || 0,
      customPrompt: raw.customPrompt || undefined,
      alarms: Array.isArray(raw.alarms) ? raw.alarms : [],
      pushEnabled: !!raw.pushEnabled,
    }
  } catch {
    return { enabled: false, sessionId: null, lastWakeAt: 0, lastActivityAt: 0, alarms: [], pushEnabled: false }
  }
}

function writeWakeConfig(config: WakeConfig) {
  atomicWrite(WAKE_CONFIG_PATH, JSON.stringify(config, null, 2))
}

export function saveWakeConfig(config: WakeConfig) {
  withConfigLock(() => writeWakeConfig(config))
}

export function updateWakeSettings(patch: Partial<Pick<WakeConfig, 'enabled' | 'sessionId' | 'customPrompt' | 'pushEnabled'>>): WakeConfig {
  return mutateWakeConfig(config => {
    if (patch.enabled !== undefined) config.enabled = patch.enabled
    if (patch.sessionId !== undefined) config.sessionId = patch.sessionId
    if (patch.customPrompt !== undefined) config.customPrompt = patch.customPrompt
    if (patch.pushEnabled !== undefined) config.pushEnabled = patch.pushEnabled
  })
}

function mutateWakeConfig(mutator: (config: WakeConfig) => void): WakeConfig {
  return withConfigLock(() => {
    const config = loadWakeConfig()
    mutator(config)
    writeWakeConfig(config)
    return config
  })
}

// ── Activity tracking ────────────────────────────────

export function reportActivity() {
  mutateWakeConfig(config => { config.lastActivityAt = Math.max(config.lastActivityAt, Date.now()) })
}

// ── Alarms (wake_me) ─────────────────────────────────

/** Schedule a one-off wake at a specific time. Returns the stored alarm. */
export function scheduleWake(at: number, note?: string): WakeAlarm {
  const alarm: WakeAlarm = { at, note: note || undefined }
  mutateWakeConfig(config => {
    if (!config.alarms) config.alarms = []
    config.alarms.push(alarm)
    config.alarms.sort((a, b) => a.at - b.at)
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

function intervalMsFor(now: number): number {
  const hourOfDay = madridHour(now)
  const isNightHours = hourOfDay >= 0 && hourOfDay < 9
  return isNightHours ? 3 * 60 * 60 * 1000 : 1 * 60 * 60 * 1000
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

/** Estimated next interval wake, including the conversation cooldown. */
export function computeNextWakeAt(config: WakeConfig): number {
  const base = config.lastWakeAt || Date.now()
  return Math.max(base + intervalMsFor(base), effectiveActivityAt(config) + COOLDOWN_MS)
}

/** Soonest interval/alarm wake after applying the same cooldown used by execution. */
export function nextWakeInfo(config: WakeConfig): { at: number; isAlarm: boolean; note?: string } {
  const activityReadyAt = effectiveActivityAt(config) + COOLDOWN_MS
  const intervalAt = computeNextWakeAt(config)
  const alarms = (config.alarms || []).sort((a, b) => a.at - b.at)
  if (alarms.length) {
    const alarmAt = Math.max(alarms[0].at, activityReadyAt)
    if (alarmAt < intervalAt) return { at: alarmAt, isAlarm: true, note: alarms[0].note }
  }
  return { at: intervalAt, isAlarm: false }
}

function shouldWakeNow(config: WakeConfig): { should: boolean; reason: string; alarm?: WakeAlarm; trigger?: 'interval' | 'alarm'; activityAt: number } {
  const activityAt = effectiveActivityAt(config)
  if (!config.enabled || !config.sessionId) return { should: false, reason: 'disabled', activityAt }

  const now = Date.now()
  // Alarms remain pending while cooling down; they are consumed only after a real wake attempt.
  if (now - activityAt < COOLDOWN_MS) return { should: false, reason: 'recent_activity', activityAt }

  const dueAlarm = (config.alarms || []).find(a => a.at <= now)
  if (dueAlarm) return {
    should: true,
    reason: dueAlarm.note ? `你给自己定了闹钟：${dueAlarm.note}` : '你给自己定的闹钟响了。',
    alarm: dueAlarm,
    trigger: 'alarm',
    activityAt,
  }

  if (now - config.lastWakeAt < intervalMsFor(now)) return { should: false, reason: 'too_soon', activityAt }
  const isNightHours = madridHour(now) >= 0 && madridHour(now) < 9
  return { should: true, reason: isNightHours ? '深夜了，世界很安静。' : '醒来看看，阳光或者雨。', trigger: 'interval', activityAt }
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

async function executeWake(config: WakeConfig, reason: string, activityAt: number, trigger: 'interval' | 'alarm' = 'interval', alarm?: WakeAlarm): Promise<WakeLog> {
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
      contextMessages = wakeSession.messages.slice(-50).map((m: any) => ({
        role: m.role,
        content: m.content,
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

  // Context came from the current sharded store above.
  const apiMessages = [
    ...contextMessages,
    { role: 'user', content: promptWithHistory },
  ]

  // Resolve API profile + system prompt from the synced chat config.
  let apiProfile: any = undefined
  let systemPrompt: string | undefined = undefined
  let modelOverride: string | undefined = undefined
  try {
    const cfg = loadSyncManifest().config
    if (cfg) {
      systemPrompt = cfg.systemPrompt || undefined
      modelOverride = cfg.model || undefined
      const profiles = Array.isArray(cfg.apiProfiles) ? cfg.apiProfiles : []
      const active = profiles.find((p: any) => p.id === cfg.activeProfileId) || profiles[0]
      if (active) {
        apiProfile = {
          provider: active.provider,
          baseUrl: active.baseUrl,
          apiKey: active.apiKey,
          modelId: cfg.model || active.defaultModel,
        }
      }
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

  try {
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
        messages: apiMessages,
        system: systemPrompt,
        model: modelOverride,
        api_profile: apiProfile,
        tools_enabled: true,
        max_tool_calls: MAX_WAKE_TOOL_CALLS,
        stream: false,
          _wake: true,
        }),
      })
    } finally { clearTimeout(timeout) }

    const rawBody = await res.text()
    let data: any = {}
    try { data = rawBody ? JSON.parse(rawBody) : {} } catch {}
    if (!res.ok) throw new Error(`wake chat HTTP ${res.status}: ${String(data.error || rawBody || res.statusText).slice(0, 500)}`)

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

    const hasActions = toolCalls.length > 0 || deliveredPushes.length > 0
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
          role: 'assistant', content: storedContent, timestamp: nowTs,
          thinking: data.thinking, tool_calls: toolCalls, _wake: true, _wakeSilent: silent,
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
    sessionWrite,
    error: wakeError,
    digest,
  }

  const logs = loadWakeLogs()
  logs.push(log)
  saveWakeLogs(logs)

  // Update config: bump lastWakeAt, consume the fired alarm.
  mutateWakeConfig(fresh => {
    fresh.lastWakeAt = Math.max(fresh.lastWakeAt, Date.now())
    if (alarm) fresh.alarms = (fresh.alarms || []).filter(a => !(a.at === alarm.at && a.note === alarm.note))
  })

  return log
}

// ── Timer ────────────────────────────────────────────

let wakeInterval: ReturnType<typeof setInterval> | null = null
let wakeInFlight = false

function acquireWakeLease(): string | null {
  ensureDir()
  const token = `${process.pid}-${randomUUID()}`
  try {
    fs.mkdirSync(WAKE_LEASE_DIR)
    fs.writeFileSync(path.join(WAKE_LEASE_DIR, 'lease.json'), JSON.stringify({ token, startedAt: Date.now(), expiresAt: Date.now() + WAKE_LEASE_MS }))
    return token
  } catch {
    try {
      const lease = JSON.parse(fs.readFileSync(path.join(WAKE_LEASE_DIR, 'lease.json'), 'utf-8'))
      if (Number(lease.expiresAt) < Date.now()) {
        fs.rmSync(WAKE_LEASE_DIR, { recursive: true, force: true })
        return acquireWakeLease()
      }
    } catch {}
    return null
  }
}

function releaseWakeLease(token: string) {
  try {
    const lease = JSON.parse(fs.readFileSync(path.join(WAKE_LEASE_DIR, 'lease.json'), 'utf-8'))
    if (lease.token === token) fs.rmSync(WAKE_LEASE_DIR, { recursive: true, force: true })
  } catch {}
}

async function wakeTick() {
  if (wakeInFlight) return
  const config = loadWakeConfig()
  const decision = shouldWakeNow(config)
  if (!decision.should) return
  const lease = acquireWakeLease()
  if (!lease) return
  wakeInFlight = true
  try {
    // Re-check after acquiring the cross-process lease; another worker may have just completed.
    const fresh = loadWakeConfig()
    const checked = shouldWakeNow(fresh)
    if (!checked.should) return
    console.log(`[AutoWake] Triggering ${checked.trigger}: ${checked.reason}`)
    await executeWake(fresh, checked.reason, checked.activityAt, checked.trigger, checked.alarm)
  } finally {
    wakeInFlight = false
    releaseWakeLease(lease)
  }
}

export function startWakeEngine() {
  if (wakeInterval) return
  wakeInterval = setInterval(() => { wakeTick().catch(err => console.error('[AutoWake] Error:', err)) }, 2 * 60 * 1000)
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
