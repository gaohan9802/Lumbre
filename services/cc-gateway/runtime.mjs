import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { publicAttempt } from './attempt-ledger.mjs'

function fingerprint(value) {
  return value ? createHash('sha256').update(value).digest('hex').slice(0, 12) : null
}

export class GatewayRuntime {
  constructor({ ledger, executor, contextBridge = null, concurrency = 1 }) {
    this.ledger = ledger
    this.executor = executor
    this.contextBridge = contextBridge
    this.concurrency = Math.max(1, concurrency)
    this.active = 0
    this.queue = []
    this.queuedIds = new Set()
    this.controllers = new Map()
    this.events = new EventEmitter()
    this.idleWaiters = []
    this.warmController = null
  }

  recover() {
    for (const id of this.ledger.recoverInterrupted()) this.schedule(id)
  }

  submit(input) {
    this.warmController?.abort()
    const existing = this.ledger.getByIdempotencyKey(input.idempotencyKey)
    if (existing) return { attempt: publicAttempt(existing), reused: true }
    const prepared = input.context
      ? this.contextBridge?.prepare(input)
      : { prompt: input.prompt, resumeSessionId: null, sessionPlan: null }
    if (!prepared) throw new Error('CC context bridge is not configured')
    const { attempt, created } = this.ledger.createOrGet({ ...input, ...prepared })
    if (created) {
      this.emitLatest(attempt)
      this.schedule(attempt.id)
    }
    return { attempt: publicAttempt(attempt), reused: !created }
  }

  cancelByIdempotencyKey(idempotencyKey) {
    const attempt = this.ledger.getByIdempotencyKey(idempotencyKey)
    return attempt ? this.cancel(attempt.id) : null
  }

  get(id) {
    return this.ledger.getPublic(id)
  }

  getEvents(id, after = 0) {
    return this.ledger.eventsAfter(id, after)
  }

  subscribe(id, listener) {
    const eventName = `attempt:${id}`
    this.events.on(eventName, listener)
    return () => this.events.off(eventName, listener)
  }

  emitLatest(attempt) {
    const event = attempt.events.at(-1)
    if (event) this.events.emit(`attempt:${attempt.id}`, event)
  }

  schedule(id) {
    if (this.queuedIds.has(id) || this.controllers.has(id)) return
    this.queuedIds.add(id)
    this.queue.push(id)
    queueMicrotask(() => this.drain())
  }

  drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const id = this.queue.shift()
      this.queuedIds.delete(id)
      const attempt = this.ledger.get(id)
      if (!attempt || attempt.status !== 'queued') continue
      this.active++
      void this.runAttempt(id).catch(() => {
        // A corrupt or unwritable ledger must fail closed without taking down
        // other queued work. Recovery will explicitly fail orphaned runs.
      }).finally(() => {
        this.active--
        this.drain()
        this.resolveIdle()
      })
    }
    this.resolveIdle()
  }

  async runAttempt(id) {
    const running = this.ledger.markRunning(id)
    this.emitLatest(running)
    const controller = new AbortController()
    this.controllers.set(id, controller)

    try {
      const result = await this.executor.run({
        prompt: running.prompt,
        model: running.model,
        resumeSessionId: running.resumeSessionId || undefined,
        attemptId: running.id,
        conversationId: running.conversationId,
        unattended: running.unattended === true,
        signal: controller.signal,
        onText: content => {
          const updated = this.ledger.appendText(id, content)
          this.emitLatest(updated)
        },
        onToolCall: toolCall => {
          const updated = this.ledger.appendToolCall(id, toolCall)
          this.emitLatest(updated)
        },
      })
      const latest = this.ledger.get(id)
      if (latest?.cancelRequested) {
        const cancelled = this.ledger.markCancelled(id)
        this.emitLatest(cancelled)
        return
      }
      const completed = this.ledger.markCompleted(id, result)
      this.emitLatest(completed)
    } catch (error) {
      const latest = this.ledger.get(id)
      if (controller.signal.aborted || latest?.cancelRequested || error?.code === 'cancelled') {
        const cancelled = this.ledger.markCancelled(id)
        this.emitLatest(cancelled)
      } else {
        const failed = this.ledger.markFailed(id, {
          code: error?.code || 'cc_failed',
          message: error?.safeMessage || 'Claude Code request failed',
        })
        this.emitLatest(failed)
      }
    } finally {
      this.controllers.delete(id)
    }
  }

  cancel(id) {
    const current = this.ledger.get(id)
    if (!current) return null
    if (['completed', 'failed', 'cancelled'].includes(current.status)) return publicAttempt(current)

    const requested = this.ledger.requestCancel(id)
    this.emitLatest(requested)
    if (requested.status === 'queued') {
      const cancelled = this.ledger.markCancelled(id)
      this.emitLatest(cancelled)
      return publicAttempt(cancelled)
    }
    this.controllers.get(id)?.abort()
    return publicAttempt(requested)
  }

  waitForIdle() {
    if (this.active === 0 && this.queue.length === 0) return Promise.resolve()
    return new Promise(resolve => this.idleWaiters.push(resolve))
  }

  busy() {
    return this.active > 0 || this.queue.length > 0
  }

  async warm(conversationId) {
    if (this.busy()) return { status: 'busy' }
    const base = this.ledger.list()
      .filter(attempt => attempt.conversationId === conversationId && attempt.status === 'completed' && attempt.result?.sessionId)
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))[0]
    if (!base) return { status: 'no_session' }

    this.active++
    const controller = new AbortController()
    this.warmController = controller
    try {
      const result = await this.executor.run({
        prompt: '[LUMBRE CACHE WARM] Reply with one period only.',
        model: base.model,
        resumeSessionId: base.result.sessionId,
        forkSession: true,
        toolsEnabled: false,
        cacheWarm: true,
        conversationId,
        signal: controller.signal,
      })
      return {
        status: 'warmed',
        usage: result.usage || null,
        context: result.context || null,
        parentSessionFingerprint: fingerprint(base.result.sessionId),
        forkSessionFingerprint: fingerprint(result.sessionId),
        transcriptRemoved: result.transcriptRemoved === true,
      }
    } catch (error) {
      if (controller.signal.aborted || error?.code === 'cancelled') return { status: 'busy' }
      return {
        status: 'failed',
        error: {
          code: error?.code || 'warm_failed',
          message: error?.safeMessage || 'Claude Code cache warm failed',
        },
      }
    } finally {
      if (this.warmController === controller) this.warmController = null
      this.active--
      this.drain()
      this.resolveIdle()
    }
  }

  metrics(conversationId) {
    const latest = this.ledger.list()
      .filter(attempt => attempt.conversationId === conversationId && attempt.status === 'completed' && attempt.result?.context)
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))[0]
    return {
      quota: {
        available: false,
        reason: 'headless_not_exposed',
        source: 'claude_code_headless',
        collectedAt: null,
      },
      context: latest?.result?.context
        ? { available: true, ...latest.result.context }
        : { available: false, reason: 'no_cc_response', source: 'last_assistant_usage', collectedAt: null },
    }
  }

  resolveIdle() {
    if (this.active !== 0 || this.queue.length !== 0) return
    for (const resolve of this.idleWaiters.splice(0)) resolve()
  }

  capabilities() {
    return { lumbreTools: this.executor.toolBridgeEnabled === true }
  }
}
