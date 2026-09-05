import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'lumbre-route-sync-'))
process.env.DATA_DIR = dir
after(() => rmSync(dir, { recursive: true, force: true }))

test('durable append, manifest and stale snapshots preserve the selected route', async () => {
  const sync = await import('../../src/server/chat-sync')
  sync.upsertSyncSessionMessage(
    'route-chat',
    { id: 'u', role: 'user', route: 'claude-code', content: 'hi', timestamp: 1 },
    { title: 'fixture', generationRoute: 'claude-code', generationRouteUpdatedAt: 100 },
  )

  let session = sync.loadSyncSessions(['route-chat'])[0]
  assert.equal(session.generationRoute, 'claude-code')
  assert.equal(session.messages[0].route, 'claude-code')
  assert.equal(sync.loadSyncManifest().sessions[0].generationRoute, 'claude-code')

  sync.mergeSyncDelta({
    sessions: [{ ...session, updatedAt: session.updatedAt + 1, generationRoute: undefined, generationRouteUpdatedAt: undefined }],
    tombstones: {},
  })
  session = sync.loadSyncSessions(['route-chat'])[0]
  assert.equal(session.generationRoute, 'claude-code')

  sync.mergeSyncDelta({
    sessions: [{ ...session, updatedAt: session.updatedAt + 1, generationRoute: 'api', generationRouteUpdatedAt: 101 }],
    tombstones: {},
  })
  assert.equal(sync.loadSyncSessions(['route-chat'])[0].generationRoute, 'api')
})

test('a route choice keeps a new empty conversation syncable', async () => {
  const sync = await import('../../src/server/chat-sync')
  sync.mergeSyncDelta({
    sessions: [{
      id: 'empty-route', title: '新的对话', messages: [], createdAt: 10, updatedAt: 11,
      generationRoute: 'claude-code', generationRouteUpdatedAt: 11,
    }],
    tombstones: {},
  })
  assert.equal(sync.loadSyncSessions(['empty-route'])[0].generationRoute, 'claude-code')
})
