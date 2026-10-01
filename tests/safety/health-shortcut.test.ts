import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-health-shortcut-'))
const secret = 'health-shortcut-fixture-secret-0000000000'
process.env.DATA_DIR = root
process.env.LUMBRE_HEALTH_SYNC_SECRET = secret

let NextRequest: typeof import('next/server').NextRequest
let route: typeof import('../../src/app/api/health/snapshot/route')
let health: typeof import('../../src/server/data/repositories/health')
let middleware: typeof import('../../src/middleware').middleware

before(async () => {
  ;({ NextRequest } = await import('next/server'))
  route = await import('../../src/app/api/health/snapshot/route')
  health = await import('../../src/server/data/repositories/health')
  ;({ middleware } = await import('../../src/middleware'))
})
after(() => rmSync(root, { recursive: true, force: true }))

function request(body: unknown, token = secret) {
  return new NextRequest('http://lumbre.test/api/health/snapshot', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

test('health shortcut endpoint authenticates, validates and merges compact daily summaries', async () => {
  const rejected = await middleware(request({}, 'f'.repeat(64)))
  assert.equal(rejected.status, 401)
  assert.deepEqual((await rejected.json()).diagnostic, {
    header_received: true,
    custom_header_received: false,
    bearer_prefix: true,
    character_length: 71,
    byte_length: 71,
    token_shape: true,
  })
  assert.equal((await route.POST(request({ date: '2026-10-01', steps: 1 }, 'wrong-secret-that-is-long-enough-000'))).status, 401)
  assert.equal((await route.POST(request(null))).status, 400)
  assert.equal((await route.POST(request({ date: 'not-a-date', steps: 1 }))).status, 400)

  const customRequest = () => new NextRequest('http://lumbre.test/api/health/snapshot', {
    method: 'POST',
    headers: { 'x-lumbre-health-token': secret, 'content-type': 'application/json' },
    body: JSON.stringify({ date: '2026-10-01', steps: 8642 }),
  })
  assert.equal((await middleware(customRequest())).headers.get('x-middleware-next'), '1')
  assert.equal((await route.POST(customRequest())).status, 200)

  const shortcutEncoded = await route.POST(request({ date: '2026-10-01', steps: ['8,642 步'] }))
  assert.equal(shortcutEncoded.status, 200)
  assert.equal((await shortcutEncoded.json()).day.steps, 8642)
  assert.equal((await route.POST(request({ date: '2026-10-01', steps: '8.642,0 count' }))).status, 200)
  assert.equal((await route.POST(request({ date: '2026-10-01', steps: '\u200e８，６４２\u200f 步' }))).status, 200)

  const steps = await route.POST(request({ date: '2026-10-01', steps: 8642 }))
  assert.equal(steps.status, 200)
  const sleep = await route.POST(request({ date: '2026-10-01', sleep_minutes: 438 }))
  assert.equal(sleep.status, 200)
  const saved = (await sleep.json()).day
  assert.equal(saved.date, '2026-10-01')
  assert.equal(saved.steps, 8642)
  assert.equal(saved.sleep_minutes, 438)
  assert.match(saved.synced_at, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \(Europe\/Madrid\)$/)

  const summary = health.readHealthSummary('today', new Date('2026-10-01T12:00:00Z'))
  assert.equal(summary.days.length, 1)
  assert.equal(summary.days[0].steps, 8642)
  assert.equal(summary.days[0].sleep_minutes, 438)
  assert.match(summary.days[0].synced_at, /\(Europe\/Madrid\)$/)
})
