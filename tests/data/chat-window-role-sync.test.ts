import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-window-role-sync-'))
process.env.DATA_DIR = root

let sync: typeof import('../../src/server/chat-sync')
before(async () => { sync = await import('../../src/server/chat-sync') })
after(() => rmSync(root, { recursive: true, force: true }))

test('durable sync keeps only the newest active chat and work window', () => {
  const session = (id: string, windowRole: 'chat' | 'work', roleAt: number) => ({
    id, title: id, messages: [{ id: `${id}-message`, role: 'user', content: id, timestamp: roleAt }],
    windowRole, windowRoleUpdatedAt: roleAt, createdAt: 1, updatedAt: roleAt, pinned: false,
  })
  sync.mergeSyncDelta({ sessions: [
    session('chat-old', 'chat', 10), session('chat-new', 'chat', 20),
    session('work-old', 'work', 11), session('work-new', 'work', 21),
  ], tombstones: {} })
  const sessions = sync.loadSyncSessions(sync.loadSyncManifest().sessions.map(item => item.id))
  assert.deepEqual(sessions.filter(item => item.windowRole === 'chat').map(item => item.id), ['chat-new'])
  assert.deepEqual(sessions.filter(item => item.windowRole === 'work').map(item => item.id), ['work-new'])
  assert.deepEqual(sessions.filter(item => item.windowRole === 'archived').map(item => item.id).sort(), ['chat-old', 'work-old'])
})

test('durable session activity advances only for user messages', () => {
  sync.mergeSyncDelta({ sessions: [{
    id: 'activity', title: 'activity', messages: [{ id: 'user-1', role: 'user', content: 'hello', timestamp: 10 }],
    createdAt: 1, updatedAt: 10, pinned: false,
  }], tombstones: {} })
  assert.equal(sync.loadSyncManifest().sessions.find(item => item.id === 'activity')?.lastUserMessageAt, 10)

  sync.appendSyncSessionMessage('activity', { id: 'wake', role: 'assistant', content: 'awake', timestamp: 20 })
  assert.equal(sync.loadSyncManifest().sessions.find(item => item.id === 'activity')?.lastUserMessageAt, 10)

  sync.appendSyncSessionMessage('activity', { id: 'user-2', role: 'user', content: 'again', timestamp: 30 })
  assert.equal(sync.loadSyncManifest().sessions.find(item => item.id === 'activity')?.lastUserMessageAt, 30)
})
