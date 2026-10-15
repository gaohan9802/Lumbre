import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-room-unread-'))
process.env.DATA_DIR = root

let unread: typeof import('../../src/server/room-unread-store')

before(async () => { unread = await import('../../src/server/room-unread-store') })
after(() => rmSync(root, { recursive: true, force: true }))

test('room unread counts persist per room and clear independently', () => {
  assert.equal(unread.readRoomUnreadCounts().photos, 0)
  unread.incrementRoomUnread('photos')
  unread.incrementRoomUnread('photos')
  unread.incrementRoomUnread('diary')
  assert.equal(unread.readRoomUnreadCounts().photos, 2)
  assert.equal(unread.readRoomUnreadCounts().diary, 1)

  unread.markRoomRead('photos')
  assert.equal(unread.readRoomUnreadCounts().photos, 0)
  assert.equal(unread.readRoomUnreadCounts().diary, 1)
})
