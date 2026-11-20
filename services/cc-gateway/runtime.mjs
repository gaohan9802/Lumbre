import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { AttemptValidationError, publicAttempt } from './attempt-ledger.mjs'
import { PINNED_CLAUDE_CODE_VERSION } from '../cc-probe/contract.mjs'

const QUOTA_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token'
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
const QUOTA_TTL_MS = 5 * 60 * 1000
const OAUTH_REFRESH_MARGIN_MS = 10 * 60 * 1000

function fingerprint(value) {
  return value ? createHash('sha256').update(value).digest('hex').slice(0, 12) : null
}

function quotaWindow(value) {
  const usedPercentage = Number(value?.utilization)
  if (!Number.isFinite(usedPercentage)) return null
  const resetsAt = typeof value?.resets_at === 'string' && Number.isFinite(Date.parse(value.resets_at))
    ? new Date(value.resets_at).toISOString() : null
  return { usedPercentage: Math.min(100, Math.max(0, usedPercentage)), resetsAt }
}

export class GatewayRuntime {
  constructor({ ledger, executor, contextBridge = null, concurrency = 1, oauthToken = '', oauthCredentialsPath = '', fetchImpl = fetch, clock = Date.now }) {
    this.ledger = ledger
    this.executor = executor
    this.contextBridge = contextBridge
    this.concurrency = Math.max(1, concurrency)
    this.oauthToken = oauthToken
    this.oauthCredentialsPath = oauthCredentialsPath
    this.fetchImpl = fetchImpl
    this.clock = clock
    this.quotaSnapshot = null
    this.quotaExpiresAt = 0
    this.quotaPending = null
    this.active = 0
    this.queue = []
    this.queuedIds = new Set()
    this.controllers = new Map()
    this.events = new EventEmitter()
    this.idleWaiters = []
    this.warmController = null
    this.compactController = null
  }

  async quotaOauthToken(forceRefresh = false) {
    if (!this.oauthCredentialsPath) return { token: this.oauthToken, reason: this.oauthToken ? null : 'oauth_token_unavailable' }
    let stored
    try { stored = JSON.parse(fs.readFileSync(this.oauthCredentialsPath, 'utf8')) }
    catch { return { token: this.oauthToken, reason: this.oauthToken ? null : 'oauth_token_unavailable' } }
    const credential = stored?.claudeAiOauth
    if (!credential?.accessToken) return { token: this.oauthToken, reason: this.oauthToken ? null : 'oauth_token_unavailable' }
    const accessExpiresAt = Number(credential.expiresAt) || 0
    if (!forceRefresh && accessExpiresAt > this.clock() + OAUTH_REFRESH_MARGIN_MS) return { token: credential.accessToken, reason: null }
    if (!credential.refreshToken) {
      return accessExpiresAt > this.clock()
        ? { token: credential.accessToken, reason: null }
        : { token: '', reason: 'oauth_reauth_required' }
    }
    if (Number(credential.refreshTokenExpiresAt) > 0 && Number(credential.refreshTokenExpiresAt) <= this.clock()) {
      return { token: '', reason: 'oauth_reauth_required' }
    }

    try {
      const scopes = Array.isArray(credential.scopes) ? credential.scopes : []
      const response = await this.fetchImpl(OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          grant_type: 'refresh_token',
          refresh_token: credential.refreshToken,
          client_id: OAUTH_CLIENT_ID,
          ...(scopes.length ? { scope: scopes.join(' ') } : {}),
        }),
        redirect: 'error',
        signal: AbortSignal.timeout(4_000),
      })
      if (!response.ok) {
        const reason = [400, 401, 403].includes(response.status) ? 'oauth_reauth_required' : 'oauth_refresh_unavailable'
        return !forceRefresh && accessExpiresAt > this.clock() ? { token: credential.accessToken, reason } : { token: '', reason }
      }
      const text = await response.text()
      if (text.length > 64_000) throw new Error('oauth refresh response too large')
      const data = JSON.parse(text)
      const expiresIn = Number(data?.expires_in)
      if (typeof data?.access_token !== 'string' || !data.access_token || !Number.isFinite(expiresIn) || expiresIn <= 0) {
        throw new Error('oauth refresh response is invalid')
      }
      const nextScopes = Array.isArray(data.scope)
        ? data.scope
        : typeof data.scope === 'string' ? data.scope.split(/\s+/).filter(Boolean) : scopes
      const refreshExpiresIn = Number(data.refresh_token_expires_in)
      stored.claudeAiOauth = {
        ...credential,
        accessToken: data.access_token,
        refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : credential.refreshToken,
        expiresAt: this.clock() + expiresIn * 1000,
        ...(nextScopes.length ? { scopes: nextScopes } : {}),
        ...(Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0
          ? { refreshTokenExpiresAt: this.clock() + refreshExpiresIn * 1000 }
          : {}),
      }
      const temporaryPath = `${this.oauthCredentialsPath}.${process.pid}.${this.clock()}.tmp`
      try {
        fs.writeFileSync(temporaryPath, JSON.stringify(stored), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
        fs.renameSync(temporaryPath, this.oauthCredentialsPath)
      } finally {
        try { fs.unlinkSync(temporaryPath) } catch {}
      }
      return { token: data.access_token, reason: null }
    } catch {
      return !forceRefresh && accessExpiresAt > this.clock()
        ? { token: credential.accessToken, reason: 'oauth_refresh_unavailable' }
        : { token: '', reason: 'oauth_refresh_unavailable' }
    }
  }

  recover() {
    const queued = this.ledger.recoverInterrupted(attempt => (
      !!attempt.resumeSessionId
      && this.executor.restoreSession?.(attempt.resumeSessionId, attempt.transcriptCheckpoint) === true
    ))
    for (const id of queued) this.schedule(id)
  }

  submit(input) {
    if (!input.requireResume) this.warmController?.abort()
    const existing = this.ledger.getByIdempotencyKey(input.idempotencyKey)
    if (existing) return { attempt: publicAttempt(existing), reused: true }
    if (input.requireResume && (this.busy() || this.warmController || this.compactController)) {
      throw new AttemptValidationError('The CC gateway is busy. Try again after the current turn finishes.')
    }
    const protectedTurnInFlight = [...this.queue, ...this.controllers.keys()].some(id => {
      const active = this.ledger.get(id)
      return active?.requireResume && active.conversationId === input.conversationId
    })
    if (protectedTurnInFlight) throw new AttemptValidationError('A protected voice turn is still running.')
    const prepared = input.context
      ? this.contextBridge?.prepare(input)
      : { prompt: input.prompt, resumeSessionId: null, sessionPlan: null }
    if (!prepared) throw new Error('CC context bridge is not configured')
    if (prepared.sessionPlan?.reason === 'reply_anchor_missing' && this.ledger.get(prepared.sessionPlan.baseAttemptId)?.requireResume) {
      throw new AttemptValidationError('The last protected voice reply has not reached chat history yet.')
    }
    if (input.requireResume) {
      if (prepared.sessionPlan?.mode !== 'resume') throw new AttemptValidationError('An existing CC session could not be resumed.')
      const base = this.ledger.get(prepared.sessionPlan.baseAttemptId)
      if (!base || base.model !== input.model || (base.effort || null) !== (input.effort || null)
        || (base.toolsEnabled !== false) !== (input.toolsEnabled !== false)) {
        throw new AttemptValidationError('The active CC model, effort or tool schema has changed.')
      }
      if (!this.executor.checkpointSession?.(prepared.resumeSessionId)) {
        throw new AttemptValidationError('The existing CC transcript is unavailable.')
      }
    }
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
    const queued = this.ledger.get(id)
    const checkpoint = queued?.resumeSessionId
      ? this.executor.checkpointSession?.(queued.resumeSessionId) || null
      : null
    if (queued?.requireResume && !checkpoint) {
      const failed = this.ledger.markFailed(id, { code: 'resume_unavailable', message: 'The existing CC transcript is unavailable.', resumeSafe: true })
      this.emitLatest(failed)
      return
    }
    const running = this.ledger.markRunning(id, checkpoint)
    this.emitLatest(running)
    const controller = new AbortController()
    this.controllers.set(id, controller)

    try {
      const result = await this.executor.run({
        prompt: running.prompt,
        systemPrompt: running.systemPrompt,
        model: running.model,
        effort: running.effort || undefined,
        resumeSessionId: running.resumeSessionId || undefined,
        attemptId: running.id,
        conversationId: running.conversationId,
        unattended: running.unattended === true,
        toolsEnabled: running.toolsEnabled !== false,
        toolCallsAllowed: running.toolCallsAllowed !== false,
        workMode: running.workMode === true,
        signal: controller.signal,
        onText: content => {
          const updated = this.ledger.appendText(id, content)
          this.emitLatest(updated)
        },
        onThinking: content => {
          const updated = this.ledger.appendThinking(id, content)
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
      if (running.requireResume && result.sessionId !== running.resumeSessionId) {
        const resumeSafe = this.executor.restoreSession?.(running.resumeSessionId, checkpoint) === true
        const failed = this.ledger.markFailed(id, { code: 'resume_mismatch', message: 'Claude Code did not resume the expected session.', resumeSafe })
        this.emitLatest(failed)
        return
      }
      const completed = this.ledger.markCompleted(id, result)
      this.emitLatest(completed)
    } catch (error) {
      const latest = this.ledger.get(id)
      if (controller.signal.aborted || latest?.cancelRequested || error?.code === 'cancelled') {
        const cancelled = this.ledger.markCancelled(id, { resumeSafe: error?.resumeSafe === true })
        this.emitLatest(cancelled)
      } else {
        const failed = this.ledger.markFailed(id, {
          code: error?.code || 'cc_failed',
          message: error?.safeMessage || 'Claude Code request failed',
          resumeSafe: error?.resumeSafe === true,
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
      const cancelled = this.ledger.markCancelled(id, { resumeSafe: true })
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

  latestCompleted(conversationId, model) {
    return this.ledger.list()
      .filter(attempt => attempt.conversationId === conversationId && attempt.status === 'completed'
        && attempt.result?.sessionId && (!model || attempt.model === model))
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))[0]
  }

  async runForkedTask(conversationId, model, prompt) {
    if (this.busy()) return { status: 'busy' }
    const base = this.latestCompleted(conversationId, model)
    if (!base) return { status: 'no_session' }

    this.active++
    const controller = new AbortController()
    this.warmController = controller
    try {
      const result = await this.executor.run({
        prompt,
        model: base.model,
        effort: base.effort || undefined,
        resumeSessionId: base.result.sessionId,
        forkSession: true,
        toolsEnabled: false,
        cacheWarm: true,
        workMode: base.workMode === true,
        conversationId,
        signal: controller.signal,
      })
      return {
        status: 'completed',
        text: result.text || '',
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
          message: error?.safeMessage || 'Claude Code forked task failed',
        },
      }
    } finally {
      if (this.warmController === controller) this.warmController = null
      this.active--
      this.drain()
      this.resolveIdle()
    }
  }

  async warm(conversationId, model) {
    const result = await this.runForkedTask(conversationId, model, '[LUMBRE CACHE WARM] Reply with one period only.')
    return result.status === 'completed' ? { ...result, status: 'warmed', text: undefined } : result
  }

  async summarize(conversationId, model, prompt) {
    return this.runForkedTask(conversationId, model, prompt)
  }

  async compact(conversationId) {
    if (this.busy()) return { status: 'busy' }
    const base = this.ledger.list()
      .filter(attempt => attempt.conversationId === conversationId && attempt.status === 'completed' && attempt.result?.sessionId)
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))[0]
    if (!base) return { status: 'no_session' }

    const checkpoint = this.executor.checkpointSession?.(base.result.sessionId) || null
    if (!checkpoint) return { status: 'checkpoint_unavailable' }

    this.active++
    const controller = new AbortController()
    this.compactController = controller
    try {
      const result = await this.executor.run({
        prompt: base.workMode === true
          ? '/compact Preserve the current task, user intent, decisions and reasons, changed and relevant files, git branch and state, commands and tool results, tests and verification, deployment state, failures, unresolved risks, and the exact next step. Drop conversational repetition and obsolete exploration.'
          : '/compact Preserve relationship context, identity, durable decisions, promises, unresolved tasks, and recent conversational tone.',
        model: base.model,
        effort: base.effort || undefined,
        resumeSessionId: base.result.sessionId,
        toolsEnabled: false,
        workMode: base.workMode === true,
        conversationId,
        signal: controller.signal,
      })
      if (result.compacted !== true) {
        this.executor.restoreSession?.(base.result.sessionId, checkpoint)
        return { status: 'unsupported' }
      }
      try {
        this.ledger.recordManualCompaction(base.id, result)
      } catch {
        this.executor.restoreSession?.(base.result.sessionId, checkpoint)
        return { status: 'failed', error: { code: 'ledger_update_failed', message: 'CC compact state could not be saved' } }
      }
      return { status: 'compacted', before: base.result.context || null, after: result.context || null }
    } catch (error) {
      this.executor.restoreSession?.(base.result.sessionId, checkpoint)
      if (controller.signal.aborted || error?.code === 'cancelled') return { status: 'busy' }
      return {
        status: 'failed',
        error: { code: error?.code || 'compact_failed', message: error?.safeMessage || 'Claude Code compact failed' },
      }
    } finally {
      if (this.compactController === controller) this.compactController = null
      this.active--
      this.drain()
      this.resolveIdle()
    }
  }

  async subscriptionQuota() {
    const now = this.clock()
    if (this.quotaSnapshot && now < this.quotaExpiresAt) return this.quotaSnapshot
    if (this.quotaPending) return this.quotaPending
    const previous = this.quotaSnapshot
    const unavailable = reason => previous?.available
      ? { ...previous, stale: true, reason }
      : { available: false, reason, source: 'anthropic_oauth_usage', collectedAt: null }
    const pending = (async () => {
      try {
        let auth = await this.quotaOauthToken()
        if (!auth.token) return unavailable(auth.reason || 'oauth_token_unavailable')
        const requestUsage = token => this.fetchImpl(QUOTA_URL, {
          headers: {
            authorization: `Bearer ${token}`,
            'anthropic-beta': 'oauth-2025-04-20',
            'user-agent': `claude-code/${PINNED_CLAUDE_CODE_VERSION}`,
            accept: 'application/json',
          },
          redirect: 'error',
          signal: AbortSignal.timeout(4_000),
        })
        let response = await requestUsage(auth.token)
        if ([401, 403].includes(response.status) && this.oauthCredentialsPath) {
          await response.body?.cancel()
          auth = await this.quotaOauthToken(true)
          if (!auth.token) return unavailable(auth.reason || 'oauth_reauth_required')
          response = await requestUsage(auth.token)
        }
        if (!response.ok) {
          return unavailable([401, 403].includes(response.status) ? 'oauth_reauth_required' : 'oauth_usage_unavailable')
        }
        const text = await response.text()
        if (text.length > 64_000) throw new Error('quota response too large')
        const data = JSON.parse(text)
        const fiveHour = quotaWindow(data?.five_hour)
        const sevenDay = quotaWindow(data?.seven_day)
        if (!fiveHour && !sevenDay) throw new Error('quota response missing windows')
        return {
          available: true,
          source: 'anthropic_oauth_usage',
          collectedAt: new Date(this.clock()).toISOString(),
          fiveHour,
          sevenDay,
        }
      } catch {
        return unavailable('oauth_usage_unavailable')
      }
    })()
    this.quotaPending = pending
    const result = await pending
    if (this.quotaPending === pending) {
      this.quotaSnapshot = result
      this.quotaExpiresAt = this.clock() + QUOTA_TTL_MS
      this.quotaPending = null
    }
    return result
  }

  async metrics(conversationId) {
    const attempts = this.ledger.list()
    const latest = attempts
      .filter(attempt => attempt.conversationId === conversationId && attempt.status === 'completed' && attempt.result?.context)
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))[0]
    const quota = await this.subscriptionQuota()
    const now = this.clock()
    const withCount = (window, duration) => {
      if (!window) return window
      const resetAt = Date.parse(window.resetsAt || '')
      const start = Number.isFinite(resetAt) && resetAt > now ? resetAt - duration : now - duration
      const requestCount = attempts.filter(attempt => {
        const createdAt = Date.parse(attempt?.createdAt || '')
        return Number.isFinite(createdAt) && createdAt >= start && createdAt <= now
      }).length
      return { ...window, requestCount }
    }
    return {
      quota: quota.available ? {
        ...quota,
        fiveHour: withCount(quota.fiveHour, 5 * 60 * 60 * 1000),
        sevenDay: withCount(quota.sevenDay, 7 * 24 * 60 * 60 * 1000),
      } : quota,
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
    return { lumbreTools: this.executor.toolBridgeEnabled === true, resumeOnlyTurns: true }
  }
}
