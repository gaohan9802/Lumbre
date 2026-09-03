import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'

import { madridDateKey } from '../../src/lib/madrid-time'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-small-state-stores-'))
process.env.DATA_DIR = root
let wish: typeof import('../../src/server/wish-store')
let thesis: typeof import('../../src/server/thesis-store')
let usage: typeof import('../../src/server/usage')

before(async () => {
  wish = await import('../../src/server/wish-store')
  thesis = await import('../../src/server/thesis-store')
  usage = await import('../../src/server/usage')
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
