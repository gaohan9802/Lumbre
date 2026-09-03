import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'

import { madridDateKey } from '../../src/lib/madrid-time'
import { DataPathError } from '../../src/server/data/errors'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-small-state-stores-'))
process.env.DATA_DIR = root
let wish: typeof import('../../src/server/wish-store')
let thesis: typeof import('../../src/server/thesis-store')
let usage: typeof import('../../src/server/usage')
let timeline: typeof import('../../src/server/timeline-store')
let period: typeof import('../../src/server/period-store')

before(async () => {
  wish = await import('../../src/server/wish-store')
  thesis = await import('../../src/server/thesis-store')
  usage = await import('../../src/server/usage')
  timeline = await import('../../src/server/timeline-store')
  period = await import('../../src/server/period-store')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('wish storage preserves CRUD behavior and safely recovers corrupt JSON', () => {
  const created = wish.addWish('fire', 'fixture wish', { priority: 'really' })
  assert.equal(wish.editWish(created.id, { status: 'doing' }), 'ok')
  assert.equal(wish.likeWish(created.id, 'star'), 'ok')
  assert.equal(wish.commentWish(created.id, 'fire', 'fixture comment'), 'ok')
  assert.equal(wish.getWishes().wishes[0]?.comments[0]?.content, 'fixture comment')
  assert.equal(wish.deleteWish(created.id), 'ok')
  assert.equal(wish.getWishes().wishes.length, 0)

  const file = path.join(root, 'wishlist', 'wishlist.json')
  writeFileSync(file, '{broken wish json', 'utf8')
  wish.addWish('fire', 'recovered wish')
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), '{broken wish json')
})

test('thesis storage preserves chapters, progress, comments, and backups', () => {
  const chapter = thesis.addChapter('fixture chapter', 20)
  assert.equal(thesis.updateChapter(chapter.id, { currentPages: 7 }), 'ok')
  assert.equal(thesis.commentThesis('star', 'keep going'), 'ok')
  assert.deepEqual(thesis.getThesis().totals, { done: 7, total: 20, percent: 35 })
  assert.equal(thesis.removeChapter(chapter.id), 'ok')
  assert.equal(existsSync(path.join(root, 'thesis', 'thesis.json.bak')), true)
})

test('usage storage obeys DATA_DIR and appends records without changing statistics', () => {
  usage.recordUsage(100, 40, 'fixture-model', 'fixture-provider')
  usage.recordUsage(30, 10, 'fixture-model', 'fixture-provider')
  const file = path.join(root, 'usage', `${madridDateKey()}.json`)
  const records = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(records.length, 2)
  assert.equal(usage.getUsageStats().today.calls, 2)
})

test('timeline keeps one current activity and preserves tags, edits, and deletion', () => {
  assert.equal(timeline.getTimelineTags().length > 0, true)
  assert.deepEqual(timeline.setTimelineTags(['工作', '工作', '阅读']), ['工作', '阅读'])
  const activity = timeline.startActivity('fixture activity', ['工作'], 'before', '2026-09-03T10:00:00+02:00')
  assert.throws(() => timeline.startActivity('second activity', ['阅读']))
  assert.equal(timeline.updateActivity(activity.id, { note: 'after' }).note, 'after')
  assert.equal(timeline.stopActivity(activity.id, 'done', '2026-09-03T11:00:00+02:00').end_note, 'done')
  assert.equal(timeline.listActivities().some(record => record.id === activity.id), true)
  assert.equal(timeline.deleteActivity(activity.id), true)
})

test('timeline recovers corrupt state with a backup before the next write', () => {
  const file = path.join(root, 'timeline', 'timeline.json')
  writeFileSync(file, '{broken timeline json', 'utf8')
  timeline.startActivity('recovered activity', ['工作'], undefined, '2026-09-03T12:00:00+02:00')
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), '{broken timeline json')
})

test('period storage validates calendar dates and records a reminder only once', () => {
  assert.throws(() => period.recordPeriodStart('2026-02-30'), DataPathError)
  assert.throws(() => period.recordPeriodEnd('../state'), DataPathError)
  const started = period.recordPeriodStart('2026-09-03')
  assert.equal(started.last_period_start, '2026-09-03')
  assert.match(period.getPeriodContext('', '2026-09-03'), /经期第1天/)
  assert.equal(period.getPeriodContext('', '2026-09-03'), '')
  assert.equal(period.recordPeriodEnd('2026-09-08').period_length, 6)
  assert.equal(period.updatePeriodConfig(30, 7).cycle_days, 30)
})

test('period storage safely recovers corrupt state', () => {
  const file = path.join(root, 'period', 'state.json')
  writeFileSync(file, '{broken period json', 'utf8')
  period.recordPeriodStart('2026-09-10')
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), '{broken period json')
})

test('malformed entries are isolated instead of breaking whole domain reads', () => {
  writeFileSync(path.join(root, 'wishlist', 'wishlist.json'), JSON.stringify({ wishes: [null, { id: 'kept', title: 'still readable' }] }), 'utf8')
  writeFileSync(path.join(root, 'thesis', 'thesis.json'), JSON.stringify({ chapters: [null, { id: 'bad-numbers', title: 'bad', totalPages: '20' }], comments: [], progress: [] }), 'utf8')
  writeFileSync(path.join(root, 'timeline', 'timeline.json'), JSON.stringify({ records: [null, { id: 'missing-fields' }] }), 'utf8')
  writeFileSync(path.join(root, 'period', 'state.json'), JSON.stringify({ cycle_days: 'wrong', period_length: null, history: [null] }), 'utf8')

  assert.deepEqual(wish.getWishes().wishes.map(value => value.id), ['kept'])
  assert.equal(thesis.getThesis().chapters.length, 0)
  assert.equal(timeline.listActivities().length, 0)
  assert.equal(period.getPeriodState().cycle_days, 28)
})

test('single-file domain repositories serialize concurrent writers', async () => {
  const worker = fileURLToPath(new URL('../fixtures/state-store-worker.ts', import.meta.url))
  const childRoot = path.join(root, 'concurrent')
  mkdirSync(childRoot, { recursive: true })

  await Promise.all(Array.from({ length: 4 }, (_, index) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', worker, 'wish', '10', `worker-${index}`], {
      env: { ...process.env, DATA_DIR: childRoot },
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`)))
  })))

  const saved = JSON.parse(readFileSync(path.join(childRoot, 'wishlist', 'wishlist.json'), 'utf8'))
  assert.equal(saved.wishes.length, 40)
})

test('timeline repository atomically allows only one concurrent current activity', async () => {
  const worker = fileURLToPath(new URL('../fixtures/state-store-worker.ts', import.meta.url))
  const childRoot = path.join(root, 'concurrent-timeline')
  mkdirSync(childRoot, { recursive: true })

  const exitCodes = await Promise.all(Array.from({ length: 4 }, (_, index) => new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', worker, 'timeline', '1', `worker-${index}`], {
      env: { ...process.env, DATA_DIR: childRoot },
      stdio: 'ignore',
    })
    child.once('error', reject)
    child.once('exit', code => resolve(code ?? 1))
  })))

  const saved = JSON.parse(readFileSync(path.join(childRoot, 'timeline', 'timeline.json'), 'utf8'))
  assert.equal(exitCodes.filter(code => code === 0).length, 1)
  assert.equal(saved.records.filter((record: any) => !record.end_at).length, 1)
})
