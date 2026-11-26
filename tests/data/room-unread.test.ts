import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  assert.equal(unread.readRoomUnreadCounts().future, 0)
  assert.equal(unread.readRoomUnreadCounts().dictionary, 0)
  assert.equal(unread.readRoomUnreadCounts().nursery, 0)
  assert.equal(unread.readRoomUnreadCounts().study, 0)
  unread.incrementRoomUnread('photos')
  unread.incrementRoomUnread('photos')
  unread.incrementRoomUnread('diary')
  assert.equal(unread.readRoomUnreadCounts().photos, 2)
  assert.equal(unread.readRoomUnreadCounts().diary, 1)
  unread.incrementRoomUnread('future')
  assert.equal(unread.readRoomUnreadCounts().future, 1)
  unread.incrementRoomUnread('dictionary')
  assert.equal(unread.readRoomUnreadCounts().dictionary, 1)
  unread.incrementRoomUnread('nursery')
  assert.equal(unread.readRoomUnreadCounts().nursery, 1)

  unread.markRoomRead('photos')
  assert.equal(unread.readRoomUnreadCounts().photos, 0)
  assert.equal(unread.readRoomUnreadCounts().diary, 1)
})

test('retired room unread counts are ignored without dropping other rooms', () => {
  const file = path.join(root, 'room-unread.json')
  writeFileSync(file, JSON.stringify({ counts: { tesis: 4, energy: 3, engawa: 2, coupons: 2, wishlist: 2, research: 2, diary: 2 }, updated_at: null }))

  assert.equal(unread.readRoomUnreadCounts().diary, 2)
  unread.markRoomRead('diary')

  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).counts, { diary: 0 })
})
