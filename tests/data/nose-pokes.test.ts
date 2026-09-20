import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-nose-pokes-'))
process.env.DATA_DIR = root

let pokes: typeof import('../../src/server/nose-pokes')

before(async () => { pokes = await import('../../src/server/nose-pokes') })
after(() => rmSync(root, { recursive: true, force: true }))

test('nose pokes stay on their Madrid day and produce a compact volatile summary', () => {
  const first = Date.parse('2026-09-20T21:14:00+02:00')
  const second = Date.parse('2026-09-20T23:59:00+02:00')
  const nextDay = Date.parse('2026-09-21T00:01:00+02:00')

  pokes.recordNosePoke(first)
  pokes.recordNosePoke(second)

  assert.equal(pokes.readNosePokes('2026-09-20').length, 2)
  assert.equal(pokes.readNosePokes('2026-09-21').length, 0)
  assert.match(pokes.dailyCompanionContext(second), /一共戳了豹子鼻子 2 次/)
  assert.match(pokes.dailyCompanionContext(second), /21:14、23:59/)
  assert.doesNotMatch(pokes.dailyCompanionContext(nextDay), /今日戳鼻子/)
})
