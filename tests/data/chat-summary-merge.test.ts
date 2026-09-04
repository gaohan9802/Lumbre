import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeChatSessionsForSync, mergeSummaryLayer } from '../../src/lib/chatStore'

test('a newer chat message cannot erase a richer summary revision', () => {
  const summary = { id: 'summary-1', eventSummary: 'kept across devices' }
  const local = { summaries: [summary], stageSummaries: [], summaryRevision: 1 }
  const newerRemoteMessageLayer = { summaries: [], stageSummaries: [], summaryRevision: 0 }

  const merged = mergeSummaryLayer(local, newerRemoteMessageLayer)
  assert.equal(merged.summaryRevision, 1)
  assert.deepEqual(merged.summaries, [summary])
})

test('an explicit newer summary revision can delete the last summary', () => {
  const local = { summaries: [{ id: 'summary-1' }], stageSummaries: [], summaryRevision: 1 }
  const remoteDeletion = { summaries: [], stageSummaries: [], summaryRevision: 2 }

  const merged = mergeSummaryLayer(local, remoteDeletion)
  assert.equal(merged.summaryRevision, 2)
  assert.deepEqual(merged.summaries, [])
})

test('a local-only summary is republished after merging a newer remote message', () => {
  const local = {
    id: 'session-1', title: 'fixture', createdAt: 1, updatedAt: 100,
    messages: [{ id: 'm1', role: 'user', content: 'desktop', timestamp: 10 }],
    summaries: [{ id: 'summary-1', eventSummary: 'local-only' }], stageSummaries: [], summaryRevision: 1,
  }
  const remote = {
    ...local, updatedAt: 200,
    messages: [...local.messages, { id: 'm2', role: 'user', content: 'phone', timestamp: 20 }],
    summaries: [], stageSummaries: [], summaryRevision: 0,
  }

  const merged = mergeChatSessionsForSync(local, remote)
  assert.equal(merged.messages.at(-1)?.content, 'phone')
  assert.equal(merged.summaries[0]?.eventSummary, 'local-only')
  assert.ok(merged.updatedAt > remote.updatedAt)
})
