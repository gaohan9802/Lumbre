import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'lumbre-message-durability-'))
process.env.DATA_DIR = dir
after(() => rmSync(dir, { recursive: true, force: true }))

test('stale snapshots cannot rewrite or revive a durable message', async () => {
  const sync = await import('../../src/server/chat-sync')
  const original = { id: 'reply-1', role: 'assistant', route: 'api', content: 'canonical', timestamp: 10 }
  sync.upsertSyncSessionMessage('conversation-1', original, { title: 'fixture' })

  let session = sync.loadSyncSessions(['conversation-1'])[0]
  sync.mergeSyncDelta({
    sessions: [{ ...session, updatedAt: session.updatedAt + 1, messages: [{ ...original, content: 'stale browser copy' }] }],
    tombstones: {},
  })
  session = sync.loadSyncSessions(['conversation-1'])[0]
  assert.equal(session.messages[0].content, 'canonical')

  const pending = { id: 'user-1', role: 'user', route: 'claude-code', content: 'hello', timestamp: 20, ccGenerationState: 'pending' }
  sync.upsertSyncSessionMessage('conversation-1', pending)
  session = sync.loadSyncSessions(['conversation-1'])[0]
  sync.mergeSyncDelta({
    sessions: [{ ...session, updatedAt: session.updatedAt + 1, messages: session.messages.map((message: any) => message.id === 'user-1' ? { ...message, ccGenerationState: 'settled' } : message) }],
    tombstones: {},
  })
  session = sync.loadSyncSessions(['conversation-1'])[0]
  assert.equal(session.messages.find((message: any) => message.id === 'user-1').ccGenerationState, 'settled')

  const deletedAt = Date.now() + 100
  sync.mergeSyncDelta({
    sessions: [{ ...session, updatedAt: deletedAt, messages: [], messageTombstones: { '*': deletedAt } }],
    tombstones: {},
  })
  session = sync.loadSyncSessions(['conversation-1'])[0]
  assert.deepEqual(session.messages, [])
  assert.equal(session.messageTombstones['*'], deletedAt)

  assert.equal(sync.upsertSyncSessionMessage('conversation-1', original).appended, false)
  assert.deepEqual(sync.loadSyncSessions(['conversation-1'])[0].messages, [])
})

test('a local message deletion survives a newer remote snapshot', async () => {
  const { useChatStore } = await import('../../src/lib/chatStore')
  const original = useChatStore.getState()
  try {
    const id = useChatStore.getState().createSession()
    useChatStore.getState().addMessage({ id: 'delete-me', role: 'assistant', route: 'api', content: 'old', timestamp: 10 })
    useChatStore.getState().deleteMessage('delete-me')
    const local = useChatStore.getState().settings.sessions.find(session => session.id === id)!
    assert.ok(local.messageTombstones?.['delete-me'])

    useChatStore.getState().mergeRemote([{
      ...local,
      updatedAt: local.updatedAt + 100,
      messages: [{ id: 'delete-me', role: 'assistant', route: 'api', content: 'old', timestamp: 10 }],
    }], {})
    assert.equal(useChatStore.getState().messages.some(message => message.id === 'delete-me'), false)
  } finally {
    useChatStore.setState(original)
  }
})
