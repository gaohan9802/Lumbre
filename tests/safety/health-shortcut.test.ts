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
  const expanded = await route.POST(request({
    date: '2026-10-01',
    resting_heart_rate_bpm: ['58 BPM'],
    hrv_ms: '42.5 ms',
    active_energy_kcal: '512,4 kcal',
    exercise_minutes: 36,
    stand_hours: 11,
    walking_running_distance_km: '6,75 km',
    vo2_max_ml_kg_min: '41.2 ml/kg/min',
    respiratory_rate_per_min: '15,8 breaths/min',
    blood_oxygen_percent: 98,
    sleeping_wrist_temperature_c: '-0.2 C',
    sleep_score: 83,
    weight_kg: '62,4 kg',
    body_fat_percent: '23.1%',
    menstruating: 1,
    menstrual_flow: 'medium',
  }))
  assert.equal(expanded.status, 200)
  const saved = (await expanded.json()).day
  assert.equal(saved.date, '2026-10-01')
  assert.equal(saved.steps, 8642)
  assert.equal(saved.sleep_minutes, 438)
  assert.equal(saved.resting_heart_rate_bpm, 58)
  assert.equal(saved.hrv_ms, 42.5)
  assert.equal(saved.active_energy_kcal, 512.4)
  assert.equal(saved.exercise_minutes, 36)
  assert.equal(saved.stand_hours, 11)
  assert.equal(saved.walking_running_distance_km, 6.75)
  assert.equal(saved.vo2_max_ml_kg_min, 41.2)
  assert.equal(saved.respiratory_rate_per_min, 15.8)
  assert.equal(saved.blood_oxygen_percent, 98)
  assert.equal(saved.sleeping_wrist_temperature_c, -0.2)
  assert.equal(saved.sleep_score, 83)
  assert.equal(saved.weight_kg, 62.4)
  assert.equal(saved.body_fat_percent, 23.1)
  assert.equal(saved.menstruating, true)
  assert.equal(saved.menstrual_flow, 'medium')
  assert.match(saved.synced_at, /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \(Europe\/Madrid\)$/)

  const summary = health.readHealthSummary('today', new Date('2026-10-01T12:00:00Z'))
  assert.equal(summary.days.length, 1)
  assert.equal(summary.days[0].steps, 8642)
  assert.equal(summary.days[0].sleep_minutes, 438)
  assert.equal(summary.days[0].resting_heart_rate_bpm, 58)
  assert.equal(summary.days[0].sleep_score, 83)
  assert.equal(summary.days[0].menstrual_flow, 'medium')
  assert.match(summary.days[0].synced_at, /\(Europe\/Madrid\)$/)
})
