import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { NextRequest } from 'next/server'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-energy-'))
process.env.DATA_DIR = root

let store: typeof import('../../src/server/energy-store')
let health: typeof import('../../src/server/data/repositories/health')
let route: typeof import('../../src/app/api/energy/route')
let runtime: typeof import('../../src/server/tool-runtime')

before(async () => {
  store = await import('../../src/server/energy-store')
  health = await import('../../src/server/data/repositories/health')
  route = await import('../../src/app/api/energy/route')
  runtime = await import('../../src/server/tool-runtime')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('energy journal combines food, caloric liquids, body fat and health-aware exercise without double counting', () => {
  store.saveEnergyProfile({ height_cm: 170, birth_date: '1996-10-13', formula_sex: 'female', goal_weight_kg: 60 })
  const body = store.saveBodyMeasurement({ date: '2026-10-13', weight_kg: 70, body_fat_percent: 28.5 }, 'fire')
  assert.equal(body.body_fat_percent, 28.5)

  store.saveEnergyEntry({ kind: 'food', date: '2026-10-13', name: '熟米饭', amount: 200, kcal_per_100: 116, meal: 'lunch', source: 'catalog' }, 'fire')
  store.saveEnergyEntry({ kind: 'liquid', date: '2026-10-13', name: '水', amount: 500, kcal_per_100: 0, meal: 'snack', source: 'catalog' }, 'fire')
  store.saveEnergyEntry({ kind: 'liquid', date: '2026-10-13', name: '可乐', amount: 250, kcal_per_100: 42, meal: 'snack', source: 'catalog' }, 'fire')
  store.saveEnergyEntry({ kind: 'exercise', date: '2026-10-13', name: '快走', duration_minutes: 40, calories: 180, not_in_health: false }, 'fire')
  store.saveEnergyEntry({ kind: 'exercise', date: '2026-10-13', name: '拉伸', duration_minutes: 20, calories: 100, not_in_health: true }, 'fire')
  health.saveHealthSnapshot({ date: '2026-10-13', active_energy_kcal: 400 })

  const dashboard = store.readEnergyDashboard('2026-10-13', 7)
  assert.equal(dashboard.today.food_kcal, 232)
  assert.equal(dashboard.today.liquid_ml, 750)
  assert.equal(dashboard.today.liquid_kcal, 105)
  assert.equal(dashboard.today.intake_kcal, 337)
  assert.equal(dashboard.today.exercise_kcal, 280)
  assert.equal(dashboard.today.health_active_kcal, 400)
  assert.equal(dashboard.today.total_burn_kcal, 1952)
  assert.equal(dashboard.today.deficit_kcal, 1615)
})

test('web writes are fixed to fire while star tools keep the star identity and support edits', async () => {
  const response = await route.POST(new NextRequest('http://lumbre.test/api/energy', {
    method: 'POST',
    body: JSON.stringify({
      action: 'entry',
      entry: { actor: 'star', kind: 'liquid', date: '2026-10-13', name: '牛奶', amount: 200, kcal_per_100: 61, meal: 'breakfast' },
    }),
  }))
  assert.equal(response.status, 200)
  const fireEntry = (await response.json()).entry
  assert.equal(fireEntry.recorded_by, 'fire')

  const starResult = JSON.parse(await runtime.executeRegisteredToolHandler('log_energy_intake', {
    kind: 'food', date: '2026-10-13', name: '鸡蛋', amount: 55, kcal_per_100: 144, meal: 'breakfast',
  }))
  assert.equal(starResult.entry.recorded_by, 'star')
  const edited = JSON.parse(await runtime.executeRegisteredToolHandler('edit_energy_entry', {
    id: starResult.entry.id, patch: { amount: 60 },
  }))
  assert.equal(edited.entry.amount, 60)
  assert.equal(edited.entry.recorded_by, 'star')

  const summary = JSON.parse(await runtime.executeRegisteredToolHandler('read_energy_summary', { date: '2026-10-13', days: 1 }))
  assert.equal(summary.today.entries.some((entry: { id: string }) => entry.id === fireEntry.id), true)
  assert.equal(summary.today.entries.some((entry: { id: string }) => entry.id === starResult.entry.id), true)
})

test('energy inputs reject unsafe and impossible values', () => {
  assert.throws(() => store.saveEnergyEntry({ kind: 'food', date: '2026-02-30', name: '米饭', amount: 100, kcal_per_100: 116 }, 'fire'))
  assert.throws(() => store.saveEnergyEntry({ kind: 'liquid', date: '2026-10-13', name: '饮料', amount: 100, kcal_per_100: -1 }, 'fire'))
  assert.throws(() => store.saveEnergyEntry({ id: 'energy_missing', amount: 200 }, 'star'), /not found/)
  assert.throws(() => store.saveBodyMeasurement({ date: '2026-10-13', weight_kg: 70, body_fat_percent: 101 }, 'fire'))
})
