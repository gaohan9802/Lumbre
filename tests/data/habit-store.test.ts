import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-habits-'))
process.env.DATA_DIR = root
let habits: typeof import('../../src/server/habit-store')

before(async () => { habits = await import('../../src/server/habit-store') })
after(() => rmSync(root, { recursive: true, force: true }))

test('habit tracker creates, renames, toggles and archives without deleting history', () => {
  const habit = habits.createHabit('拉伸')
  const water = habits.createHabit('喝水')
  assert.equal(habits.toggleHabit(habit.id, '2026-11-27').completed_dates[0], '2026-11-27')
  habits.toggleHabit(water.id, '2026-01-01')
  habits.toggleHabit(water.id, '2026-11-27')
  assert.equal(habits.habitContext('2026-11-27T12:00:00+01:00'), '今日打卡：拉伸、喝水\n全年打卡：拉伸 1 次、喝水 2 次')
  assert.deepEqual(habits.toggleHabit(habit.id, '2026-11-27').completed_dates, [])
  habits.toggleHabit(habit.id, '2026-11-26')
  assert.equal(habits.renameHabit(habit.id, '睡前拉伸').name, '睡前拉伸')
  habits.archiveHabit(habit.id)
  habits.archiveHabit(water.id)
  assert.equal(habits.listHabits().length, 0)
  assert.deepEqual(habits.listHabits(true)[0]?.completed_dates, ['2026-11-26'])
})

test('habit tracker rejects invalid dates and missing habits', () => {
  const habit = habits.createHabit('阅读')
  assert.throws(() => habits.toggleHabit(habit.id, '2026-02-30'))
  assert.throws(() => habits.toggleHabit(habit.id, '2099-01-01'), /不能提前/)
  assert.throws(() => habits.renameHabit('missing', '不存在'), /习惯不存在/)
})
