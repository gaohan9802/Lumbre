import assert from 'node:assert/strict'
import test from 'node:test'
import { DEFAULT_SETTINGS } from '../../src/features/chat/state/defaults'
import { createSummaryBookmarkActions } from '../../src/features/chat/summaries/actions'

test('stage summaries can be edited, locked, unlocked, and deleted', () => {
  const sessionId = DEFAULT_SETTINGS.sessions[0].id
  const stage = { id: 'stage-1', sessionId, createdAt: 1, startAt: 1, endAt: 2, sourceSummaryIds: ['sum-1'], title: '旧标题', content: '旧内容' }
  let state: any = { settings: { ...DEFAULT_SETTINGS, sessions: [{ ...DEFAULT_SETTINGS.sessions[0], stageSummaries: [stage] }] }, messages: [] }
  const actions = createSummaryBookmarkActions((update) => { state = { ...state, ...update(state) } })

  actions.updateStageSummary(sessionId, stage.id, { title: '新标题', locked: true })
  assert.equal(state.settings.sessions[0].stageSummaries[0].title, '新标题')
  actions.updateStageSummary(sessionId, stage.id, { content: '不应写入' })
  assert.equal(state.settings.sessions[0].stageSummaries[0].content, '旧内容')
  actions.updateStageSummary(sessionId, stage.id, { locked: false })
  actions.deleteStageSummary(sessionId, stage.id)
  assert.equal(state.settings.sessions[0].stageSummaries.length, 0)
})
