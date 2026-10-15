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
  health.saveHealthSnapshot({ date: '2026-10-13', steps: 8_432, sleep_minutes: 430, active_energy_kcal: 400, exercise_minutes: 50, weight_kg: 69.8, body_fat_percent: 28.2 })
  const waterGoal = store.saveEnergyGoal({ date: '2026-10-13', title: '喝水 500 ml' }, 'fire')
  const exerciseGoal = store.saveEnergyGoal({ date: '2026-10-13', title: '运动 70 分钟' }, 'fire')
  const manualGoal = store.saveEnergyGoal({ date: '2026-10-13', title: '早点睡觉' }, 'fire')

  const dashboard = store.readEnergyDashboard('2026-10-13', 7)
  assert.equal(dashboard.today.food_kcal, 232)
  assert.equal(dashboard.today.liquid_ml, 750)
  assert.equal(dashboard.today.water_ml, 500)
  assert.equal(dashboard.today.liquid_kcal, 105)
  assert.equal(dashboard.today.intake_kcal, 337)
  assert.equal(dashboard.today.exercise_kcal, 280)
  assert.equal(dashboard.today.exercise_minutes, 70)
  assert.equal(dashboard.today.health_active_kcal, 400)
  assert.equal(dashboard.today.baseline_kcal, 1452)
  assert.equal(dashboard.today.activity_kcal, 500)
  assert.equal(dashboard.today.total_burn_kcal, 1952)
  assert.equal(dashboard.today.deficit_kcal, 1615)
  assert.equal(dashboard.today.health?.steps, 8_432)
  assert.equal(dashboard.today.health?.weight_kg, 69.8)
  assert.equal(dashboard.today.health?.body_fat_percent, 28.2)
  assert.deepEqual(dashboard.goals.find(goal => goal.id === waterGoal.id)?.progress, { kind: 'water_ml', current: 500, target: 500, unit: 'ml' })
  assert.equal(dashboard.goals.find(goal => goal.id === waterGoal.id)?.done, true)
  assert.equal(dashboard.goals.find(goal => goal.id === exerciseGoal.id)?.done, true)
  assert.equal(dashboard.goals.find(goal => goal.id === manualGoal.id)?.done, false)
})

test('manual baselines stay effective from their saved date instead of rewriting history', () => {
  store.saveEnergyProfile({ manual_baseline_kcal: 1_400 }, '2026-10-10')
  store.saveEnergyProfile({ manual_baseline_kcal: 1_500 }, '2026-10-11')
  assert.equal(store.readEnergyDashboard('2026-10-10', 1).today.baseline_kcal, 1_400)
  assert.equal(store.readEnergyDashboard('2026-10-11', 1).today.baseline_kcal, 1_500)
  store.saveEnergyProfile({ manual_baseline_kcal: null }, '2026-10-12')
  assert.notEqual(store.readEnergyDashboard('2026-10-12', 1).today.baseline_kcal, 1_500)
})

test('health weight supports calculations and same-day manual measurements are updated in place', () => {
  health.saveHealthSnapshot({ date: '2026-10-14', weight_kg: 68, body_fat_percent: 27.5 })
  const exercise = store.saveEnergyEntry({ kind: 'exercise', date: '2026-10-14', name: '散步', duration_minutes: 30, met: 3.5 }, 'star')
  assert.ok(exercise.calories > 0)
  const synced = store.readEnergyDashboard('2026-10-14', 1)
  assert.equal(synced.today.health?.weight_kg, 68)
  assert.ok(synced.today.baseline_kcal)

  const first = store.saveBodyMeasurement({ date: '2026-10-14', weight_kg: 67.5, body_fat_percent: 27 }, 'fire')
  const second = store.saveBodyMeasurement({ date: '2026-10-14', weight_kg: 67.2, body_fat_percent: 26.8 }, 'fire')
  assert.equal(second.id, first.id)
  const dashboard = store.readEnergyDashboard('2026-10-14', 1)
  assert.equal(dashboard.measurements.filter(item => item.date === '2026-10-14' && item.recorded_by === 'fire').length, 1)
  assert.equal(dashboard.current_measurement?.weight_kg, 67.2)
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

  const pantryResponse = await route.POST(new NextRequest('http://lumbre.test/api/energy', {
    method: 'POST',
    body: JSON.stringify({ action: 'pantry', item: { actor: 'star', name: '番茄', quantity: '4个' } }),
  }))
  const firePantry = (await pantryResponse.json()).item
  assert.equal(firePantry.recorded_by, 'fire')
  const groceryResponse = await route.POST(new NextRequest('http://lumbre.test/api/energy', {
    method: 'POST',
    body: JSON.stringify({ action: 'grocery', item: { actor: 'star', name: '燕麦', quantity: '1袋' } }),
  }))
  const fireGrocery = (await groceryResponse.json()).item
  assert.equal(fireGrocery.recorded_by, 'fire')

  const starResult = JSON.parse(await runtime.executeRegisteredToolHandler('log_energy_intake', {
    kind: 'food', date: '2026-10-13', name: '鸡蛋', amount: 55, kcal_per_100: 144, meal: 'breakfast',
  }))
  assert.equal(starResult.entry.recorded_by, 'star')
  const edited = JSON.parse(await runtime.executeRegisteredToolHandler('edit_energy_entry', {
    id: starResult.entry.id, patch: { amount: 60 },
  }))
  assert.equal(edited.entry.amount, 60)
  assert.equal(edited.entry.recorded_by, 'star')

  const starPantry = JSON.parse(await runtime.executeRegisteredToolHandler('save_pantry_item', { name: '鸡蛋', quantity: '6个' })).item
  assert.equal(starPantry.recorded_by, 'star')
  const starGrocery = JSON.parse(await runtime.executeRegisteredToolHandler('save_grocery_item', { name: '菠菜', quantity: '2把' })).item
  assert.equal(starGrocery.recorded_by, 'star')
  const bought = JSON.parse(await runtime.executeRegisteredToolHandler('save_grocery_item', { id: starGrocery.id, done: true })).item
  assert.equal(bought.done, true)
  const starGoal = JSON.parse(await runtime.executeRegisteredToolHandler('save_energy_goal', { date: '2026-10-13', title: '散步 30 分钟' })).goal
  assert.equal(starGoal.recorded_by, 'star')
  const completedGoal = JSON.parse(await runtime.executeRegisteredToolHandler('save_energy_goal', { id: starGoal.id, done: true })).goal
  assert.equal(completedGoal.done, true)

  const summaryText = await runtime.executeRegisteredToolHandler('read_energy_summary', { date: '2026-10-13', days: 1 })
  assert.ok(summaryText.length < 16_000)
  const summary = JSON.parse(summaryText)
  assert.equal(summary.today.entries.some((entry: { id: string }) => entry.id === fireEntry.id), true)
  assert.equal(summary.today.entries.some((entry: { id: string }) => entry.id === starResult.entry.id), true)
  assert.equal(summary.pantry.some((item: { id: string }) => item.id === firePantry.id), true)
  assert.equal(summary.pantry.some((item: { id: string }) => item.id === starPantry.id), true)
  assert.equal(summary.groceries.some((item: { id: string }) => item.id === fireGrocery.id), true)
  assert.equal(summary.groceries.some((item: { id: string; done: boolean }) => item.id === starGrocery.id && item.done), true)
  assert.equal(summary.goals.some((goal: { id: string; done: boolean }) => goal.id === starGoal.id && goal.done), true)
  assert.equal(summary.today.entry_count >= summary.today.entries.length, true)
  assert.equal(summary.days[0].entry_count > 0, true)
  assert.equal('entries' in summary.days[0], false)

  const clearResponse = await route.POST(new NextRequest('http://lumbre.test/api/energy', {
    method: 'POST', body: JSON.stringify({ action: 'clear_completed_groceries' }),
  }))
  assert.equal((await clearResponse.json()).removed, 1)
  assert.equal(store.readEnergyDashboard('2026-10-13', 1).groceries.some(item => item.id === starGrocery.id), false)
})

test('energy inputs reject unsafe and impossible values', () => {
  assert.throws(() => store.saveEnergyEntry({ kind: 'food', date: '2026-02-30', name: '米饭', amount: 100, kcal_per_100: 116 }, 'fire'))
  assert.throws(() => store.saveEnergyEntry({ kind: 'liquid', date: '2026-10-13', name: '饮料', amount: 100, kcal_per_100: -1 }, 'fire'))
  assert.throws(() => store.saveEnergyEntry({ id: 'energy_missing', amount: 200 }, 'star'), /not found/)
  assert.throws(() => store.saveBodyMeasurement({ date: '2026-10-13', weight_kg: 70, body_fat_percent: 101 }, 'fire'))
  assert.throws(() => store.saveGroceryItem({ id: 'grocery_missing', done: true }, 'star'), /not found/)
})

test('tool summary remains complete JSON under the output budget with verbose records', () => {
  for (let index = 0; index < 30; index++) {
    store.saveEnergyEntry({
      kind: 'food', date: '2026-10-15', name: `详细食物 ${index} ${'x'.repeat(50)}`,
      amount: 100, kcal_per_100: 100, note: '备注'.repeat(240),
    }, 'fire')
  }
  const text = JSON.stringify(store.readEnergyToolSummary('2026-10-15', 30))
  assert.ok(text.length <= 14_000)
  assert.doesNotThrow(() => JSON.parse(text))
})
