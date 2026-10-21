import assert from 'node:assert/strict'
import test from 'node:test'
import { updateComposerDraft } from '../../src/features/chat/view/composerDrafts'

test('composer drafts stay isolated by chat session', () => {
  let drafts = updateComposerDraft({}, 'session-a', 'input', '只留在 A 窗口')
  drafts = updateComposerDraft(drafts, 'session-a', 'pendingImages', previous => [...previous, 'a.jpg'])
  drafts = updateComposerDraft(drafts, 'session-b', 'input', '只留在 B 窗口')

  assert.equal(drafts['session-a'].input, '只留在 A 窗口')
  assert.deepEqual(drafts['session-a'].pendingImages, ['a.jpg'])
  assert.equal(drafts['session-b'].input, '只留在 B 窗口')
  assert.deepEqual(drafts['session-b'].pendingImages, [])
})
