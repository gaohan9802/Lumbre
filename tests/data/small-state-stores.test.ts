import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

import { madridDateKey } from '../../src/lib/madrid-time'
import { DataPathError } from '../../src/server/data/errors'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-small-state-stores-'))
process.env.DATA_DIR = root
let usage: typeof import('../../src/server/usage')
let period: typeof import('../../src/server/period-store')

before(async () => {
  usage = await import('../../src/server/usage')
  period = await import('../../src/server/period-store')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('usage storage obeys DATA_DIR and appends records without changing statistics', () => {
  usage.recordUsage(100, 40, 'fixture-model', 'fixture-provider')
  usage.recordUsage(30, 10, 'fixture-model', 'fixture-provider')
  const file = path.join(root, 'usage', `${madridDateKey()}.json`)
  const records = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(records.length, 2)
  assert.equal(usage.getUsageStats().today.calls, 2)
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
  writeFileSync(path.join(root, 'period', 'state.json'), JSON.stringify({ cycle_days: 'wrong', period_length: null, history: [null] }), 'utf8')

  assert.equal(period.getPeriodState().cycle_days, 28)
})
