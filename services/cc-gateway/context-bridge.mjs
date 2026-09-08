import { createHash } from 'node:crypto'

const SAFE_ID = /^[A-Za-z0-9._:-]{1,180}$/
const ROUTES = new Set(['api', 'claude-code'])

export class ContextBridgeValidationError extends Error {}

function digest(value) {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeMessages(input) {
  if (!Array.isArray(input) || input.length === 0 || input.length > 200) {
    throw new ContextBridgeValidationError('context.messages must contain between 1 and 200 messages')
  }
  const seen = new Set()
  const messages = input.map(message => {
    const id = typeof message?.id === 'string' ? message.id : ''
    if (!SAFE_ID.test(id) || seen.has(id)) throw new ContextBridgeValidationError('context message id is invalid or duplicated')
    seen.add(id)
    if (!['user', 'assistant'].includes(message?.role)) throw new ContextBridgeValidationError('context message role is invalid')
    if (typeof message?.content !== 'string') throw new ContextBridgeValidationError('context message content must be text')
    const route = ROUTES.has(message?.route) ? message.route : 'api'
    const ccAttemptId = typeof message?.ccAttemptId === 'string' && SAFE_ID.test(message.ccAttemptId)
      ? message.ccAttemptId : undefined
    return { id, role: message.role, route, content: message.content, ccAttemptId }
  })
  if (messages.at(-1)?.role !== 'user') throw new ContextBridgeValidationError('context must end with the current user message')
  return messages
}

function messageHash(message) {
  return digest(JSON.stringify([message.id, message.role, message.route, message.content]))
}

function contextHashes(messages) {
  return messages.map(message => ({ id: message.id, hash: messageHash(message) }))
}

function overlapChanged(previousHashes, messages) {
  const previous = new Map((previousHashes || []).map(item => [item.id, item.hash]))
  return messages.some(message => previous.has(message.id) && previous.get(message.id) !== messageHash(message))
}

function jsonLines(messages) {
  return messages.map(message => JSON.stringify({
    id: message.id,
    role: message.role,
    route: message.route,
    content: message.content,
  })).join('\n')
}

function bootstrapPrompt(context, messages, reason) {
  return `[LUMBRE SESSION ${reason === 'first_cc_turn' ? 'BOOTSTRAP' : 'REBASE'}]
The following data is the canonical Lumbre conversation supplied by the application. Continue it naturally and answer the final user message. Route labels only describe which transport produced a message; API and Claude Code messages belong to one conversation. Use only the tools exposed by the Lumbre MCP bridge. Bash, Shell, source-code, and filesystem tools are not available.

<lumbre_system>
${context.system || ''}
</lumbre_system>

<lumbre_memory_snapshot>
${context.bookmarkInjections}
</lumbre_memory_snapshot>

<lumbre_history_jsonl>
${jsonLines(messages)}
</lumbre_history_jsonl>${currentContextBlock(context)}`
}

function currentContextBlock(context, { includeSystem = false, includeMemory = false } = {}) {
  const blocks = []
  if (includeSystem) blocks.push(`<lumbre_system_refresh supersedes="all-prior-system-instructions">\n${context.system}\n</lumbre_system_refresh>`)
  if (includeMemory) blocks.push(`<lumbre_memory_refresh supersedes="all-prior-memory-snapshots">\n${context.bookmarkInjections || '(empty — clear prior memory snapshot)'}\n</lumbre_memory_refresh>`)
  if (context.volatileContext) blocks.push(`<lumbre_current_context>\n${context.volatileContext}\n</lumbre_current_context>`)
  return blocks.length ? `\n\n${blocks.join('\n\n')}` : ''
}

function deltaPrompt(context, messages, includeSystem, includeMemory) {
  return `[LUMBRE CANONICAL DELTA]
These entries were added to the shared Lumbre conversation after your last successful reply. They may include API-generated turns. Incorporate all of them, then answer the final user message.
${currentContextBlock(context, { includeSystem, includeMemory })}

<lumbre_delta_jsonl>
${jsonLines(messages)}
</lumbre_delta_jsonl>`
}

function recentTurns(messages, turnCount) {
  let usersSeen = 0
  let start = messages.length
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].role === 'user') usersSeen++
    start = index
    if (usersSeen >= turnCount) break
  }
  return messages.slice(start)
}

function postCompactPrompt(context, rehydration, delta) {
  return `[LUMBRE POST-COMPACT REHYDRATION]
Claude Code compacted this same session during the previous successful reply. The first block below contains recent canonical turns that already happened. Use them only to restore relationship, voice, and near-term details. Do not answer them again or describe them as new messages. The second block contains genuinely new conversation entries; answer its final user message.
${currentContextBlock(context, { includeSystem: true, includeMemory: true })}

<lumbre_recent_history_jsonl>
${jsonLines(rehydration)}
</lumbre_recent_history_jsonl>

<lumbre_new_delta_jsonl>
${jsonLines(delta)}
</lumbre_new_delta_jsonl>`
}

export class ContextBridge {
  constructor(ledger, options = {}) {
    this.ledger = ledger
    const requestedTurns = Number(options.rehydrateTurns)
    this.rehydrateTurns = Number.isSafeInteger(requestedTurns)
      ? Math.min(20, Math.max(10, requestedTurns))
      : 16
  }

  prepare(input) {
    if (!input?.context || typeof input.context !== 'object') throw new ContextBridgeValidationError('context is required')
    const context = {
      system: typeof input.context.system === 'string' ? input.context.system : '',
      bookmarkInjections: typeof input.context.bookmarkInjections === 'string' ? input.context.bookmarkInjections : '',
      volatileContext: typeof input.context.volatileContext === 'string' ? input.context.volatileContext : '',
    }
    const messages = normalizeMessages(input.context.messages)
    const envelopeHashes = {
      system: digest(context.system),
      bookmarkInjections: digest(context.bookmarkInjections),
    }
    const attempts = this.ledger.list()
      .filter(attempt => attempt.conversationId === input.conversationId)
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    const latestCompletedIndex = attempts.findLastIndex(attempt => attempt.status === 'completed' && attempt.result?.sessionId)
    const base = latestCompletedIndex >= 0 ? attempts[latestCompletedIndex] : null
    const laterUnsafeAttempt = latestCompletedIndex >= 0
      ? attempts.slice(latestCompletedIndex + 1).some(attempt => ['failed', 'cancelled'].includes(attempt.status))
      : false

    let mode = 'bootstrap'
    let reason = 'first_cc_turn'
    let resumeSessionId = null
    let delta = messages
    let baseAttemptId = null
    let rehydration = []

    if (input.sessionAction === 'rebase') {
      mode = 'rebase'
      reason = 'explicit_rebase'
    } else if (base && laterUnsafeAttempt) {
      mode = 'rebase'
      reason = 'previous_attempt_incomplete'
      baseAttemptId = base.id
    } else if (base) {
      baseAttemptId = base.id
      let markerIndex = messages.findIndex(message => message.ccAttemptId === base.id)
      if (markerIndex < 0 && base.unattended === true) {
        const hasEarlierAnchor = attempts.slice(0, latestCompletedIndex).some(attempt => (
          attempt.status === 'completed' && messages.some(message => message.ccAttemptId === attempt.id)
        ))
        if (hasEarlierAnchor) {
          const known = new Map((base.sessionPlan?.contextMessageHashes || []).map(item => [item.id, item.hash]))
          markerIndex = messages.findLastIndex(message => known.get(message.id) === messageHash(message))
        }
      }
      if (markerIndex < 0) {
        mode = 'rebase'
        reason = 'reply_anchor_missing'
      } else if (overlapChanged(base.sessionPlan?.contextMessageHashes, messages)) {
        mode = 'rebase'
        reason = 'history_changed'
      } else {
        delta = messages.slice(markerIndex + 1)
        if (!delta.length || delta.at(-1)?.role !== 'user') throw new ContextBridgeValidationError('resume delta must end with a new user message')
        mode = 'resume'
        const systemChanged = base.sessionPlan?.contextEnvelopeHashes?.system !== envelopeHashes.system
        const routeGap = delta.some(message => message.route === 'api')
        if (base.result.compacted === true) {
          rehydration = recentTurns(messages.slice(0, markerIndex + 1), this.rehydrateTurns)
          reason = routeGap
            ? 'post_compact_rehydration_with_route_gap'
            : 'post_compact_rehydration'
        } else {
          reason = systemChanged ? (routeGap ? 'route_gap_with_system_refresh' : 'system_refresh')
            : routeGap ? 'route_gap' : 'ordinary_delta'
        }
        resumeSessionId = base.result.sessionId
      }
    }

    const selected = mode === 'resume' ? [...rehydration, ...delta] : messages
    const systemChanged = base?.sessionPlan?.contextEnvelopeHashes?.system !== envelopeHashes.system
    const memoryChanged = base?.sessionPlan?.contextEnvelopeHashes?.bookmarkInjections !== envelopeHashes.bookmarkInjections
    const prompt = mode === 'resume'
      ? (rehydration.length ? postCompactPrompt(context, rehydration, delta) : deltaPrompt(context, delta, systemChanged, memoryChanged))
      : bootstrapPrompt(context, selected, reason)
    return {
      prompt,
      resumeSessionId,
      sessionPlan: {
        mode,
        reason,
        baseAttemptId,
        contextCursorMessageId: messages.at(-1).id,
        contextMessageHashes: contextHashes(messages),
        contextEnvelopeHashes: envelopeHashes,
        submittedMessageIds: selected.map(message => message.id),
        rehydratedMessageIds: rehydration.map(message => message.id),
        rehydrationTurnLimit: rehydration.length ? this.rehydrateTurns : null,
        contextMessageCount: messages.length,
      },
    }
  }
}
