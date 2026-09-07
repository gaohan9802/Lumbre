import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { assertGatewayDataDir, readJson, withFileLock, writeJsonAtomic } from './storage.mjs'

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled'])
const ATTEMPT_ID = /^[0-9a-f-]{36}$/i
const SAFE_KEY = /^[A-Za-z0-9._:-]{1,160}$/
const SAFE_MODEL = /^[A-Za-z0-9._:-]{1,120}$/

export class AttemptValidationError extends Error {}

function nowIso(clock) {
  return new Date(clock()).toISOString()
}

function hashKey(value) {
  return createHash('sha256').update(value).digest('hex')
}

function validateCreateInput(input) {
  if (!input || typeof input !== 'object') throw new AttemptValidationError('Request body must be an object')
  if (typeof input.idempotencyKey !== 'string' || !SAFE_KEY.test(input.idempotencyKey)) {
    throw new AttemptValidationError('idempotency_key is invalid')
  }
  if (typeof input.conversationId !== 'string' || !SAFE_KEY.test(input.conversationId)) {
    throw new AttemptValidationError('conversation_id is invalid')
  }
  if (typeof input.prompt !== 'string' || !input.prompt.trim() || Buffer.byteLength(input.prompt) > 1_500_000) {
    throw new AttemptValidationError('prompt must be between 1 byte and 1.5 MB')
  }
  if (typeof input.model !== 'string' || !SAFE_MODEL.test(input.model)) {
    throw new AttemptValidationError('model is invalid')
  }
}

function publicEvent(event) {
  return { ...event }
}

export function publicAttempt(attempt) {
  if (!attempt) return null
  return {
    id: attempt.id,
    conversationId: attempt.conversationId,
    model: attempt.model,
    status: attempt.status,
    cancelRequested: attempt.cancelRequested,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
    startedAt: attempt.startedAt,
    completedAt: attempt.completedAt,
    result: attempt.result,
    error: attempt.error,
    sessionMode: attempt.sessionPlan?.mode || null,
    sessionReason: attempt.sessionPlan?.reason || null,
    lastEventId: attempt.events.at(-1)?.id || 0,
  }
}

export class AttemptLedger {
  constructor(dataDir, options = {}) {
    this.dataDir = assertGatewayDataDir(dataDir)
    this.attemptsDir = path.join(this.dataDir, 'attempts')
    this.indexPath = path.join(this.dataDir, 'idempotency-index.json')
    this.clock = options.clock || Date.now
    fs.mkdirSync(this.attemptsDir, { recursive: true, mode: 0o700 })
    this.rebuildIndex()
  }

  attemptPath(id) {
    if (!ATTEMPT_ID.test(id)) throw new AttemptValidationError('attempt id is invalid')
    return path.join(this.attemptsDir, `${id}.json`)
  }

  list() {
    return fs.readdirSync(this.attemptsDir)
      .filter(name => ATTEMPT_ID.test(name.replace(/\.json$/, '')) && name.endsWith('.json'))
      .map(name => readJson(path.join(this.attemptsDir, name)))
  }

  rebuildIndex() {
    return withFileLock(this.indexPath, () => {
      const index = {}
      for (const attempt of this.list().sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
        if (typeof attempt.idempotencyHash === 'string' && !index[attempt.idempotencyHash]) {
          index[attempt.idempotencyHash] = attempt.id
        }
      }
      writeJsonAtomic(this.indexPath, index)
      return index
    })
  }

  get(id) {
    try { return readJson(this.attemptPath(id)) }
    catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  getPublic(id) {
    return publicAttempt(this.get(id))
  }

  createOrGet(input) {
    validateCreateInput(input)
    const idempotencyHash = hashKey(input.idempotencyKey)
    return withFileLock(this.indexPath, () => {
      const index = readJson(this.indexPath, {})
      const existingId = index[idempotencyHash]
      const existing = existingId ? this.get(existingId) : null
      if (existing) return { attempt: existing, created: false }

      const id = randomUUID()
      const timestamp = nowIso(this.clock)
      const attempt = {
        schemaVersion: 1,
        id,
        idempotencyHash,
        conversationId: input.conversationId,
        prompt: input.prompt,
        resumeSessionId: input.resumeSessionId || null,
        sessionPlan: input.sessionPlan || null,
        model: input.model,
        status: 'queued',
        cancelRequested: false,
        createdAt: timestamp,
        updatedAt: timestamp,
        startedAt: null,
        completedAt: null,
        result: null,
        error: null,
        events: [{ id: 1, type: 'queued', at: timestamp }],
      }
      writeJsonAtomic(this.attemptPath(id), attempt)
      index[idempotencyHash] = id
      writeJsonAtomic(this.indexPath, index)
      return { attempt, created: true }
    })
  }

  getByIdempotencyKey(idempotencyKey) {
    if (typeof idempotencyKey !== 'string' || !SAFE_KEY.test(idempotencyKey)) {
      throw new AttemptValidationError('idempotency_key is invalid')
    }
    const index = readJson(this.indexPath, {})
    const id = index[hashKey(idempotencyKey)]
    return id ? this.get(id) : null
  }

  update(id, operation) {
    const filePath = this.attemptPath(id)
    return withFileLock(filePath, () => {
      const current = readJson(filePath)
      const next = operation(structuredClone(current))
      next.updatedAt = nowIso(this.clock)
      writeJsonAtomic(filePath, next)
      // The first atomic replacement backs up the running record, which still
      // contains the prompt. Replace once more so both primary and latest
      // recovery backup contain the scrubbed terminal record.
      if (typeof current.prompt === 'string' && next.prompt === null) writeJsonAtomic(filePath, next)
      return next
    })
  }

  appendEvent(attempt, type, data = {}) {
    const event = {
      id: (attempt.events.at(-1)?.id || 0) + 1,
      type,
      at: nowIso(this.clock),
      ...data,
    }
    attempt.events.push(event)
    return event
  }

  markRunning(id) {
    return this.update(id, attempt => {
      if (attempt.status !== 'queued') throw new Error('Only queued attempts can start')
      attempt.status = 'running'
      attempt.startedAt = nowIso(this.clock)
      attempt.error = null
      this.appendEvent(attempt, 'running')
      return attempt
    })
  }

  appendText(id, content) {
    if (!content) return this.get(id)
    return this.update(id, attempt => {
      if (attempt.status !== 'running') return attempt
      this.appendEvent(attempt, 'text', { content })
      return attempt
    })
  }

  appendToolCall(id, toolCall) {
    return this.update(id, attempt => {
      if (attempt.status !== 'running') return attempt
      this.appendEvent(attempt, 'tool_call', {
        name: String(toolCall?.name || '').slice(0, 120),
        input: toolCall?.input && typeof toolCall.input === 'object' ? toolCall.input : {},
        result: String(toolCall?.result || '').slice(0, 16_000),
        error: toolCall?.error === true,
      })
      return attempt
    })
  }

  requestCancel(id) {
    return this.update(id, attempt => {
      if (TERMINAL_STATUSES.has(attempt.status) || attempt.cancelRequested) return attempt
      attempt.cancelRequested = true
      this.appendEvent(attempt, 'cancel_requested')
      return attempt
    })
  }

  markCompleted(id, result) {
    return this.update(id, attempt => {
      if (attempt.status !== 'running') throw new Error('Only running attempts can complete')
      if (attempt.cancelRequested) throw new Error('A cancelled attempt cannot complete')
      attempt.status = 'completed'
      attempt.completedAt = nowIso(this.clock)
      attempt.prompt = null
      attempt.result = result
      attempt.error = null
      this.appendEvent(attempt, 'completed', { usage: result.usage || null })
      return attempt
    })
  }

  markFailed(id, error) {
    return this.update(id, attempt => {
      if (TERMINAL_STATUSES.has(attempt.status)) return attempt
      attempt.status = 'failed'
      attempt.completedAt = nowIso(this.clock)
      attempt.prompt = null
      attempt.result = null
      attempt.error = { code: error.code || 'cc_failed', message: error.message || 'Claude Code request failed' }
      this.appendEvent(attempt, 'failed', { error: attempt.error })
      return attempt
    })
  }

  markCancelled(id) {
    return this.update(id, attempt => {
      if (TERMINAL_STATUSES.has(attempt.status)) return attempt
      attempt.status = 'cancelled'
      attempt.cancelRequested = true
      attempt.completedAt = nowIso(this.clock)
      attempt.prompt = null
      attempt.result = null
      attempt.error = null
      this.appendEvent(attempt, 'cancelled')
      return attempt
    })
  }

  eventsAfter(id, after = 0) {
    const attempt = this.get(id)
    if (!attempt) return null
    return attempt.events.filter(event => event.id > after).map(publicEvent)
  }

  recoverInterrupted() {
    const queued = []
    for (const attempt of this.list()) {
      if (attempt.status === 'running') {
        this.markFailed(attempt.id, { code: 'gateway_restarted', message: 'CC gateway restarted before completion' })
      } else if (attempt.status === 'queued') queued.push(attempt.id)
    }
    return queued
  }
}
