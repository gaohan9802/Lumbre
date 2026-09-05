import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
const dir = mkdtempSync(path.join(tmpdir(), 'lumbre-mode-sync-'))
process.env.DATA_DIR = dir
after(() => rmSync(dir, { recursive: true, force: true }))

test('durable append, manifest, stale snapshots and old outbox preserve mode and one reply', async () => {
  const sync = await import('../../src/server/chat-sync')
  const message = { id: 'u', role: 'user', content: 'hi', timestamp: 1, replyMode: 'short' }
  sync.upsertSyncSessionMessage('a', message, { title: 'fixture', conversationMode: 'short', conversationModeUpdatedAt: 100 })
  let session = sync.loadSyncSessions(['a'])[0]
  assert.equal(session.conversationMode, 'short')
  assert.equal(sync.loadSyncManifest().sessions[0].conversationMode, 'short')
  sync.mergeSyncDelta({ sessions: [{ ...session, updatedAt: session.updatedAt + 1, conversationMode: undefined, conversationModeUpdatedAt: undefined }], tombstones: {} })
  session = sync.loadSyncSessions(['a'])[0]
  assert.equal(session.conversationMode, 'short')
  sync.mergeSyncDelta({ sessions: [{ ...session, updatedAt: session.updatedAt + 1, conversationMode: 'long', conversationModeUpdatedAt: 101 }], tombstones: {} })
  const reply = { id: 'a1', role: 'assistant', timestamp: 2, content: '一\n\n二', replyMode: 'short', content_blocks: [{ type: 'text', content: '一' }, { type: 'text', content: '二' }] }
  sync.upsertSyncSessionMessage('a', reply, { conversationMode: 'short', conversationModeUpdatedAt: 100 })
  sync.upsertSyncSessionMessage('a', reply, { conversationMode: 'short', conversationModeUpdatedAt: 100 })
  session = sync.loadSyncSessions(['a'])[0]
  assert.equal(session.conversationMode, 'long')
  assert.equal(session.messages.length, 2)
  assert.equal(session.messages[1].content_blocks.length, 2)
  assert.equal(session.messages[1].replyMode, 'short')
  assert.equal(sync.loadSyncManifest().sessions[0].messageCount, 2)
})

test('a selected mode survives syncing a new empty conversation', async () => {
  const sync = await import('../../src/server/chat-sync')
  sync.mergeSyncDelta({ sessions: [{ id: 'empty-mode', title: '新的对话', messages: [], createdAt: 10, updatedAt: 11, conversationMode: 'short', conversationModeUpdatedAt: 11 }], tombstones: {} })
  assert.equal(sync.loadSyncSessions(['empty-mode'])[0].conversationMode, 'short')
})
