import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { AttemptLedger } from '../../services/cc-gateway/attempt-ledger.mjs'
import { ContextBridge } from '../../services/cc-gateway/context-bridge.mjs'

function context(messages: any[]) {
  return { system: 'You are Star.', bookmarkInjections: 'shared memory', volatileContext: 'now', messages }
}

function complete(ledger: any, bridge: any, input: any, sessionId = '550e8400-e29b-41d4-a716-446655440000', result: Record<string, unknown> = {}) {
  const prepared = bridge.prepare(input)
  const attempt = ledger.createOrGet({ ...input, ...prepared }).attempt
  ledger.markRunning(attempt.id)
  ledger.markCompleted(attempt.id, { text: 'first answer', sessionId, usage: null, ...result })
  return { attempt: ledger.get(attempt.id), prepared }
}

test('first CC turn bootstraps from canonical Lumbre context without storing context content twice', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-context-first-'))
  try {
    const ledger = new AttemptLedger(root)
    const bridge = new ContextBridge(ledger)
    const prepared = bridge.prepare({
      conversationId: 'conversation-1',
      context: context([{ id: 'u1', role: 'user', route: 'api', content: 'hello' }]),
    })
    assert.equal(prepared.sessionPlan.mode, 'bootstrap')
    assert.equal(prepared.sessionPlan.reason, 'first_cc_turn')
    assert.equal(prepared.resumeSessionId, null)
    assert.match(prepared.prompt, /You are Star/)
    assert.match(prepared.prompt, /"content":"hello"/)
    assert.match(prepared.prompt, /Bash, Shell, source-code, and filesystem tools are not available/)
    assert.doesNotMatch(prepared.prompt, /Never claim to have tools in this phase/)
    assert.equal(JSON.stringify(prepared.sessionPlan).includes('hello'), false)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a confirmed compact resumes the same session and rehydrates only recent canonical turns once', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-context-compact-'))
  try {
    const ledger = new AttemptLedger(root)
    const bridge = new ContextBridge(ledger, { rehydrateTurns: 10 })
    const history = []
    for (let index = 1; index <= 12; index++) {
      history.push({ id: `u${index}`, role: 'user', route: index === 12 ? 'claude-code' : 'api', content: `user ${index}` })
      if (index < 12) history.push({ id: `a${index}`, role: 'assistant', route: 'api', content: `answer ${index}` })
    }
    const first = complete(ledger, bridge, {
      idempotencyKey: 'turn-1', conversationId: 'conversation-1', model: 'sonnet',
      context: context(history),
    }, undefined, { compacted: true })
    const prepared = bridge.prepare({
      conversationId: 'conversation-1',
      context: context([
        ...history,
        { id: 'a12', role: 'assistant', route: 'claude-code', ccAttemptId: first.attempt.id, content: 'first answer' },
        { id: 'u13', role: 'user', route: 'claude-code', content: 'new question' },
      ]),
    })
    assert.equal(prepared.sessionPlan.mode, 'resume')
    assert.equal(prepared.sessionPlan.reason, 'post_compact_rehydration')
    assert.equal(prepared.resumeSessionId, first.attempt.result.sessionId)
    assert.equal(prepared.sessionPlan.rehydrationTurnLimit, 10)
    assert.deepEqual(prepared.sessionPlan.rehydratedMessageIds, [
      'u3', 'a3', 'u4', 'a4', 'u5', 'a5', 'u6', 'a6', 'u7', 'a7',
      'u8', 'a8', 'u9', 'a9', 'u10', 'a10', 'u11', 'a11', 'u12', 'a12',
    ])
    assert.match(prepared.prompt, /already happened/)
    assert.match(prepared.prompt, /new question/)
    assert.doesNotMatch(prepared.prompt, /user 2/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('API route gaps are sent as a delta while the same CC session is resumed', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-context-gap-'))
  try {
    const ledger = new AttemptLedger(root)
    const bridge = new ContextBridge(ledger)
    const first = complete(ledger, bridge, {
      idempotencyKey: 'turn-1', conversationId: 'conversation-1', model: 'sonnet',
      context: context([{ id: 'u1', role: 'user', route: 'claude-code', content: 'first' }]),
    })
    const prepared = bridge.prepare({
      conversationId: 'conversation-1',
      context: context([
        { id: 'u1', role: 'user', route: 'claude-code', content: 'first' },
        { id: 'a1', role: 'assistant', route: 'claude-code', ccAttemptId: first.attempt.id, content: 'first answer' },
        { id: 'u2', role: 'user', route: 'api', content: 'ask API' },
        { id: 'a2', role: 'assistant', route: 'api', content: 'API answer' },
        { id: 'u3', role: 'user', route: 'claude-code', content: 'back to CC' },
      ]),
    })
    assert.equal(prepared.sessionPlan.mode, 'resume')
    assert.equal(prepared.sessionPlan.reason, 'route_gap')
    assert.equal(prepared.resumeSessionId, first.attempt.result.sessionId)
    assert.deepEqual(prepared.sessionPlan.submittedMessageIds, ['u2', 'a2', 'u3'])
    assert.doesNotMatch(prepared.prompt, /first answer/)
    assert.match(prepared.prompt, /API answer/)
    assert.match(prepared.prompt, /<lumbre_current_context>\s*now/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('a silent unattended wake keeps the same session without adding a fake chat message', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-context-silent-wake-'))
  try {
    const ledger = new AttemptLedger(root)
    const bridge = new ContextBridge(ledger)
    const first = complete(ledger, bridge, {
      idempotencyKey: 'turn-1', conversationId: 'conversation-1', model: 'sonnet',
      context: context([{ id: 'u1', role: 'user', route: 'claude-code', content: 'first' }]),
    })
    const visible = [
      { id: 'u1', role: 'user', route: 'claude-code', content: 'first' },
      { id: 'a1', role: 'assistant', route: 'claude-code', ccAttemptId: first.attempt.id, content: 'first answer' },
      { id: 'u2', role: 'user', route: 'api', content: 'API gap before wake' },
      { id: 'a2', role: 'assistant', route: 'api', content: 'API gap answer' },
    ]
    const wake = complete(ledger, bridge, {
      idempotencyKey: 'wake-1', conversationId: 'conversation-1', model: 'sonnet', unattended: true,
      context: context([...visible, { id: 'wake-user', role: 'user', route: 'claude-code', content: 'silent wake' }]),
    }, first.attempt.result.sessionId)

    const resumed = bridge.prepare({
      conversationId: 'conversation-1',
      context: context([...visible, { id: 'u3', role: 'user', route: 'claude-code', content: 'real next message' }]),
    })
    assert.equal(resumed.sessionPlan.mode, 'resume')
    assert.equal(resumed.resumeSessionId, wake.attempt.result.sessionId)
    assert.deepEqual(resumed.sessionPlan.submittedMessageIds, ['u3'])
    assert.match(resumed.prompt, /real next message/)
    assert.doesNotMatch(resumed.prompt, /API gap before wake/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('resume refreshes changed memory while a changed system creates a fresh recorded session', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-context-envelope-'))
  try {
    const ledger = new AttemptLedger(root)
    const bridge = new ContextBridge(ledger)
    const first = complete(ledger, bridge, {
      idempotencyKey: 'turn-1', conversationId: 'conversation-1', model: 'sonnet',
      context: context([{ id: 'u1', role: 'user', route: 'claude-code', content: 'first' }]),
    })
    const messages = [
      { id: 'u1', role: 'user', route: 'claude-code', content: 'first' },
      { id: 'a1', role: 'assistant', route: 'claude-code', ccAttemptId: first.attempt.id, content: 'first answer' },
      { id: 'u2', role: 'user', route: 'claude-code', content: 'continue' },
    ]
    const memoryRefresh = bridge.prepare({
      conversationId: 'conversation-1',
      context: { ...context(messages), bookmarkInjections: 'new summary' },
    })
    assert.equal(memoryRefresh.sessionPlan.mode, 'resume')
    assert.match(memoryRefresh.prompt, /<lumbre_memory_refresh>\s*new summary/)

    const systemRefresh = bridge.prepare({
      conversationId: 'conversation-1',
      context: { ...context(messages), system: 'You are a changed Star.' },
    })
    assert.equal(systemRefresh.sessionPlan.mode, 'rebase')
    assert.equal(systemRefresh.sessionPlan.reason, 'system_changed')
    assert.equal(systemRefresh.resumeSessionId, null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('edited overlap or an incomplete resume creates a recorded fresh generation', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-context-rebase-'))
  try {
    const ledger = new AttemptLedger(root)
    const bridge = new ContextBridge(ledger)
    const first = complete(ledger, bridge, {
      idempotencyKey: 'turn-1', conversationId: 'conversation-1', model: 'sonnet',
      context: context([{ id: 'u1', role: 'user', route: 'claude-code', content: 'original' }]),
    })
    const changed = bridge.prepare({
      conversationId: 'conversation-1',
      context: context([
        { id: 'u1', role: 'user', route: 'claude-code', content: 'edited' },
        { id: 'a1', role: 'assistant', route: 'claude-code', ccAttemptId: first.attempt.id, content: 'first answer' },
        { id: 'u2', role: 'user', route: 'claude-code', content: 'continue' },
      ]),
    })
    assert.equal(changed.sessionPlan.mode, 'rebase')
    assert.equal(changed.sessionPlan.reason, 'history_changed')
    assert.equal(changed.resumeSessionId, null)

    const failedPrepared = bridge.prepare({
      conversationId: 'conversation-1',
      context: context([
        { id: 'u1', role: 'user', route: 'claude-code', content: 'original' },
        { id: 'a1', role: 'assistant', route: 'claude-code', ccAttemptId: first.attempt.id, content: 'first answer' },
        { id: 'u2', role: 'user', route: 'claude-code', content: 'will fail' },
      ]),
    })
    const failed = ledger.createOrGet({ idempotencyKey: 'turn-2', conversationId: 'conversation-1', model: 'sonnet', ...failedPrepared }).attempt
    ledger.markRunning(failed.id)
    ledger.markFailed(failed.id, { code: 'fixture', message: 'failed' })

    const afterFailure = bridge.prepare({
      conversationId: 'conversation-1',
      context: context([
        { id: 'u1', role: 'user', route: 'claude-code', content: 'original' },
        { id: 'a1', role: 'assistant', route: 'claude-code', ccAttemptId: first.attempt.id, content: 'first answer' },
        { id: 'u3', role: 'user', route: 'claude-code', content: 'safe retry' },
      ]),
    })
    assert.equal(afterFailure.sessionPlan.mode, 'rebase')
    assert.equal(afterFailure.sessionPlan.reason, 'previous_attempt_incomplete')
    assert.equal(afterFailure.resumeSessionId, null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('resume refuses duplicate ids and contexts that do not end in a user turn', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-context-invalid-'))
  try {
    const bridge = new ContextBridge(new AttemptLedger(root))
    assert.throws(() => bridge.prepare({ conversationId: 'c', context: context([
      { id: 'same', role: 'user', content: 'one' }, { id: 'same', role: 'user', content: 'two' },
    ]) }), /duplicated/)
    assert.throws(() => bridge.prepare({ conversationId: 'c', context: context([
      { id: 'a', role: 'assistant', content: 'no user' },
    ]) }), /end with/)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
