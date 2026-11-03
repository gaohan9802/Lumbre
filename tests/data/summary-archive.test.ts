import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import type { SummaryArchiveEntry } from '../../src/lib/summary-archive'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-summary-archive-'))
process.env.DATA_DIR = root

let repository: typeof import('../../src/server/data/repositories/summary-archive')
let archive: typeof import('../../src/server/summary-archive')
let runtime: typeof import('../../src/server/tool-runtime')

function entry(id: string, level: SummaryArchiveEntry['level'], periodKey: string, startAt: number, sourceIds: string[] = []): SummaryArchiveEntry {
  return {
    id, level, periodKey, startAt, endAt: startAt + 1, createdAt: startAt, updatedAt: startAt,
    title: level === 'daily' ? undefined : id, content: id, sourceIds, sourceDigest: id,
    locked: false, needsCorrection: false,
  }
}

before(async () => {
  repository = await import('../../src/server/data/repositories/summary-archive')
  archive = await import('../../src/server/summary-archive')
  runtime = await import('../../src/server/tool-runtime')
  const entries = [
    entry('daily-1', 'daily', '2026-10-01', 1),
    entry('daily-2', 'daily', '2026-10-02', 2),
    entry('daily-3', 'daily', '2026-10-03', 3),
    entry('daily-4', 'daily', '2026-10-04', 4),
    entry('weekly-1', 'weekly', '2026-10-01..2026-10-07', 5, ['daily-2']),
    entry('monthly-1', 'monthly', '2026-10', 6, ['weekly-1']),
    entry('daily-nov', 'daily', '2026-11-01', 7),
  ]
  repository.updateSummaryArchiveData(current => ({ ...current, entries }))
})

after(() => rmSync(root, { recursive: true, force: true }))

test('archive context injects only the latest three daily cards and one stage card', () => {
  const context = archive.summaryArchiveContext()
  assert.doesNotMatch(context, /daily-1/)
  assert.doesNotMatch(context, /daily-2/)
  assert.match(context, /daily-3/)
  assert.match(context, /daily-4/)
  assert.match(context, /daily-nov/)
  assert.match(context, /weekly-1/)
  assert.doesNotMatch(context, /monthly-1/)
})

test('month filters include the whole month and exclude the next one', () => {
  const results = archive.searchSummaryArchive({ level: 'daily', from: '2026-10', to: '2026-10' })
  assert.deepEqual(results.map(item => item.id), ['daily-4', 'daily-3', 'daily-2', 'daily-1'])
})

test('editing a source marks every derived card and locking prevents edits', () => {
  archive.updateSummaryArchiveEntry('daily-2', { content: 'corrected' })
  assert.equal(archive.readSummaryArchiveEntry('weekly-1').needsCorrection, true)
  assert.equal(archive.readSummaryArchiveEntry('monthly-1').needsCorrection, true)
  archive.updateSummaryArchiveEntry('daily-2', { locked: true })
  assert.throws(() => archive.updateSummaryArchiveEntry('daily-2', { content: 'blocked' }), /已锁定/)
  archive.updateSummaryArchiveEntry('daily-2', { locked: false })
  assert.equal(archive.readSummaryArchiveEntry('daily-2').locked, false)
})

test('calendar stages stay inside a natural month and keep a short month-end stage', () => {
  assert.deepEqual(archive.stagePeriods('2026-10-03', '2026-10-31').map(period => period.key), [
    '2026-10-03..2026-10-07',
    '2026-10-08..2026-10-14',
    '2026-10-15..2026-10-21',
    '2026-10-22..2026-10-28',
    '2026-10-29..2026-10-31',
  ])
})

test('summary read tool returns the exact card without internal source or writer metadata', async () => {
  const result = JSON.parse(await runtime.executeRegisteredToolHandler('read_summary', { id: 'monthly-1' }))
  assert.equal(result.content, 'monthly-1')
  assert.equal(result.sourceIds, undefined)
  assert.equal(result.sourceDigest, undefined)
  assert.equal(result.writer, undefined)
})
