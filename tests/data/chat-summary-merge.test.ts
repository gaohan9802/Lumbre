import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeSummaryLayer } from '../../src/lib/chatStore'

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
