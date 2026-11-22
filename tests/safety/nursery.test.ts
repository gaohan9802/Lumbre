import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-nursery-'))
const secret = 'nursery-event-fixture-secret-0000000000'
process.env.DATA_DIR = root
process.env.NURSERY_EVENT_TOKEN = secret

let auth: typeof import('../../src/server/nursery-auth')
let events: typeof import('../../src/server/nursery-events')
let route: typeof import('../../src/app/api/internal/nursery-events/route')
let middleware: typeof import('../../src/middleware').middleware
let unread: typeof import('../../src/server/room-unread-store')
let NextRequest: typeof import('next/server').NextRequest

before(async () => {
  auth = await import('../../src/server/nursery-auth')
  events = await import('../../src/server/nursery-events')
  route = await import('../../src/app/api/internal/nursery-events/route')
  ;({ middleware } = await import('../../src/middleware'))
  ;({ NextRequest } = await import('next/server'))
  unread = await import('../../src/server/room-unread-store')
})

after(() => rmSync(root, { recursive: true, force: true }))

test('Nursery webhook bearer token fails closed', () => {
  assert.equal(auth.isTrustedNurseryEventRequest(null), false)
  assert.equal(auth.isTrustedNurseryEventRequest('Bearer wrong-but-long-enough-000000000000'), false)
  assert.equal(auth.isTrustedNurseryEventRequest(`Bearer ${secret}`), true)
})

test('Nursery events are bounded, sanitized and idempotent', () => {
  assert.equal(events.saveNurseryEvent({ idempotency_key: 'cry-1', kind: 'nursery.cry', text: '醒了\n在哭', ts: 1 }), true)
  assert.equal(events.saveNurseryEvent({ idempotency_key: 'cry-1', kind: 'nursery.cry', text: '重复' }), false)
  const saved = events.readNurseryEvents()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].id, 'cry-1')
  assert.equal(saved[0].text, '醒了 在哭')
  assert.throws(() => events.saveNurseryEvent({ kind: 'nursery.cry' }), /identity/)
})

test('private Nursery webhook bypasses browser auth and increments unread once', async () => {
  const request = () => new NextRequest('https://xsidereal.beer/api/internal/nursery-events', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ idempotency_key: 'ask-2', kind: 'nursery.ask', text: '来看看我' }),
  })
  assert.equal((await middleware(request())).headers.get('x-middleware-next'), '1')
  assert.equal((await route.POST(request())).status, 200)
  assert.equal((await route.POST(request())).status, 200)
  assert.equal(unread.readRoomUnreadCounts().nursery, 1)
})
