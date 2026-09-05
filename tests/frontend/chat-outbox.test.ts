import assert from 'node:assert/strict'
import test from 'node:test'
import { chatApi } from '../../src/features/chat/api/client'

test('offline outbox deduplicates a turn and retries it after connectivity returns', async () => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
  const originalAppend = chatApi.appendMessage
  const delivered: string[] = []
  const deliveredMeta: any[] = []
  chatApi.appendMessage = (async (_sessionId: string, message: any, sessionMeta: any) => {
    delivered.push(message.id)
    deliveredMeta.push(sessionMeta)
    return { ok: true }
  }) as typeof chatApi.appendMessage

  try {
    const { flushChatOutbox, queueChatAppend } = await import('../../src/features/chat/sync/outbox')
    const session: any = { id: 's', title: 'S', pinned: false, createdAt: 1, updatedAt: 1, messages: [], generationRoute: 'claude-code', generationRouteUpdatedAt: 3 }
    const message: any = { id: 'm', role: 'user', route: 'claude-code', content: 'offline', timestamp: 2 }
    await queueChatAppend(session, message)
    await queueChatAppend(session, message)
    await flushChatOutbox()
    assert.deepEqual(delivered, [])

    ;(globalThis.navigator as any).onLine = true
    await flushChatOutbox()
    assert.deepEqual(delivered, ['m'])
    assert.equal(deliveredMeta[0].generationRoute, 'claude-code')
    assert.equal(deliveredMeta[0].generationRouteUpdatedAt, 3)
    assert.equal(values.get('lumbre-chat-outbox-fallback'), '[]')
  } finally {
    chatApi.appendMessage = originalAppend
    delete (globalThis as any).localStorage
    delete (globalThis as any).navigator
  }
})
