import assert from 'node:assert/strict'
import test from 'node:test'
import { isRecoverableChatDisconnect, mergeConversationRoute, normalizeChatRoute } from '../../src/lib/chat-route'
import { normalizeSettings } from '../../src/features/chat/migrations/browser-state'
import { snapshotOfMessage } from '../../src/features/chat/sessions/messages'

test('old conversations and message versions normalize to the API route', () => {
  const settings = normalizeSettings({
    activeSessionId: 'old',
    sessions: [{
      id: 'old', title: 'old', pinned: false, createdAt: 1, updatedAt: 2,
      messages: [{
        id: 'm', role: 'assistant', content: 'old reply', timestamp: 2,
        versions: [{ content: 'older reply', timestamp: 1 }],
      }],
    }],
  })

  assert.equal(settings.sessions[0].generationRoute, 'api')
  assert.equal(settings.sessions[0].messages[0].route, 'api')
  assert.equal(settings.sessions[0].messages[0].versions?.[0].route, 'api')
  assert.equal(normalizeChatRoute('not-a-route'), 'api')
})

test('a newer route selection wins independently from a newer message snapshot', () => {
  const selected = { generationRoute: 'claude-code', generationRouteUpdatedAt: 50 }
  assert.deepEqual(mergeConversationRoute(selected, { updatedAt: 100 }), selected)
  assert.deepEqual(
    mergeConversationRoute(selected, { generationRoute: 'api', generationRouteUpdatedAt: 51 }),
    { generationRoute: 'api', generationRouteUpdatedAt: 51 },
  )
})

test('an iOS Load failed keeps only CC turns recoverable', () => {
  assert.equal(isRecoverableChatDisconnect('claude-code', false, 'TypeError'), true)
  assert.equal(isRecoverableChatDisconnect('api', false, 'TypeError'), false)
  assert.equal(isRecoverableChatDisconnect('claude-code', true, 'AbortError'), false)
})

test('route persists through store continuation, stale sync and message versions', async () => {
  const { useChatStore } = await import('../../src/lib/chatStore')
  const original = useChatStore.getState()
  try {
    const id = useChatStore.getState().createSession()
    useChatStore.getState().setGenerationRoute(id, 'claude-code')
    useChatStore.getState().addMessage({ id: 'cc-reply', role: 'assistant', route: 'claude-code', content: 'hi', timestamp: 1 })
    const current = useChatStore.getState().settings.sessions.find(session => session.id === id)!

    const continued = useChatStore.getState().continueSession(50)
    assert.equal(useChatStore.getState().settings.sessions.find(session => session.id === continued)?.generationRoute, 'claude-code')

    useChatStore.getState().setActiveSession(id)
    useChatStore.getState().mergeRemote([{ ...current, updatedAt: Date.now() + 20, generationRoute: undefined, generationRouteUpdatedAt: undefined }], {})
    assert.equal(useChatStore.getState().settings.sessions.find(session => session.id === id)?.generationRoute, 'claude-code')

    useChatStore.getState().addMessageVersion('cc-reply', { route: 'api', content: 'api reroll', timestamp: 2 })
    assert.equal(useChatStore.getState().messages[0].route, 'api')
    useChatStore.getState().switchMessageVersion('cc-reply', 0)
    assert.equal(useChatStore.getState().messages[0].route, 'claude-code')
    assert.equal(snapshotOfMessage(useChatStore.getState().messages[0]).route, 'claude-code')
  } finally {
    useChatStore.setState(original)
  }
})
