import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { NextRequest } from 'next/server'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-user-context-'))
process.env.DATA_DIR = root
let context: typeof import('../../src/server/agent/tools/user-context')
let route: typeof import('../../src/app/api/weather/route')

before(async () => {
  context = await import('../../src/server/agent/tools/user-context')
  route = await import('../../src/app/api/weather/route')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('precise user location is persisted and reused in model context', () => {
  const saved = context.updateUserContext({
    lat: 40.416812,
    lon: -3.70381,
    accuracy: 7.4,
    temp: 21.2,
    weatherCode: 1,
    city: 'Madrid',
    road: 'Calle Mayor',
    houseNumber: '1',
    address: 'Calle Mayor 1, Madrid',
  })

  assert.deepEqual(context.getUserContext(), saved)
  const prompt = context.preciseLocationContext(saved.updatedAt + 120_000)
  assert.match(prompt, /40\.416812/)
  assert.match(prompt, /-3\.70381/)
  assert.match(prompt, /±7 米/)
  assert.match(prompt, /Calle Mayor 1, Madrid/)
  assert.match(prompt, /距今 2 分钟/)
})

test('invalid coordinates never replace the saved snapshot', () => {
  const before = context.getUserContext()
  assert.throws(() => context.updateUserContext({ lat: 91, lon: 0 }), /Invalid user location context/)
  assert.deepEqual(context.getUserContext(), before)
})

test('weather endpoint exposes the exact shared snapshot and rejects bad GPS', async () => {
  const snapshot = await (await route.GET()).json()
  assert.equal(snapshot.lat, 40.416812)
  assert.equal(snapshot.lon, -3.70381)
  assert.equal(snapshot.accuracy, 7.4)

  const rejected = await route.POST(new NextRequest('http://lumbre.test/api/weather', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ lat: 400, lon: -3.7 }),
  }))
  assert.equal(rejected.status, 400)
})
