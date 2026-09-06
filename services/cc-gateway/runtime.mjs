import { EventEmitter } from 'node:events'
import { publicAttempt } from './attempt-ledger.mjs'

export class GatewayRuntime {
  constructor({ ledger, executor, concurrency = 1 }) {
    this.ledger = ledger
    this.executor = executor
    this.concurrency = Math.max(1, concurrency)
    this.active = 0
    this.queue = []
    this.queuedIds = new Set()
    this.controllers = new Map()
    this.events = new EventEmitter()
    this.idleWaiters = []
  }

  recover() {
    for (const id of this.ledger.recoverInterrupted()) this.schedule(id)
  }

  submit(input) {
    const { attempt, created } = this.ledger.createOrGet(input)
    if (created) {
      this.emitLatest(attempt)
      this.schedule(attempt.id)
    }
    return { attempt: publicAttempt(attempt), reused: !created }
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
        signal: controller.signal,
        onText: content => {
          const updated = this.ledger.appendText(id, content)
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

  resolveIdle() {
    if (this.active !== 0 || this.queue.length !== 0) return
    for (const resolve of this.idleWaiters.splice(0)) resolve()
  }
}
