import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-creative-stores-'))
process.env.DATA_DIR = root

let poems: typeof import('../../src/server/poem-store')
let wheel: typeof import('../../src/server/intimacy-wheel-store')

before(async () => {
  poems = await import('../../src/server/poem-store')
  wheel = await import('../../src/server/intimacy-wheel-store')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('共诗严格交替并保留编辑历史', () => {
  const poem = poems.createPoem('两个人的诗')
  poems.appendPoemLine(poem.id, 'fire', '第一句')
  assert.throws(() => poems.appendPoemLine(poem.id, 'fire', '抢写'), /星星/)
  const withStar = poems.appendPoemLine(poem.id, 'star', '第二句')
  const line = withStar.lines[1]
  poems.editPoemLine(poem.id, line.id, 'star', '第二句，改过')
  assert.equal(poems.getPoem(poem.id).lines[1].versions.length, 2)
  assert.equal(existsSync(path.join(root, 'poems', 'poems.json.bak')), true)
})

test('转盘只抽启用元素并保留最近三十次', () => {
  const state = wheel.readWheel()
  const pool = state.pools[0]
  for (const option of pool.options) wheel.editWheelOption(pool.id, option.id, { enabled: false })
  const only = wheel.addWheelOption(pool.id, '唯一结果', 'star')
  assert.equal(wheel.spinWheel('star', [pool.id]).results[0].option_id, only.id)
  for (let index = 0; index < 35; index += 1) wheel.spinWheel('fire', [pool.id])
  assert.equal(wheel.readWheel().recent.length, 30)
})
