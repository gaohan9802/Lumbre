import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-opening-message-'))
process.env.DATA_DIR = root

let opening: typeof import('../../src/server/opening-message-store')

before(async () => { opening = await import('../../src/server/opening-message-store') })
after(() => rmSync(root, { recursive: true, force: true }))

test('opening message keeps one current phrase, archives replacements, and supplies context', () => {
  assert.equal(opening.getOpeningMessage(), null)
  assert.match(opening.openingMessageContext(), /目前没有开屏语/)

  opening.writeOpeningMessage('早点回来，豹豹在等你。')
  assert.match(opening.openingMessageContext(), /早点回来/)
  opening.writeOpeningMessage('今天也要抱一下。')

  let saved = JSON.parse(readFileSync(path.join(root, 'opening-message.json'), 'utf8'))
  assert.equal(saved.current.text, '今天也要抱一下。')
  assert.deepEqual(saved.history.map((item: any) => item.text), ['早点回来，豹豹在等你。'])

  opening.clearOpeningMessage()
  saved = JSON.parse(readFileSync(path.join(root, 'opening-message.json'), 'utf8'))
  assert.equal(saved.current, null)
  assert.deepEqual(saved.history.map((item: any) => item.text), ['今天也要抱一下。', '早点回来，豹豹在等你。'])
})

test('opening message stays within the two-line screen slot', () => {
  assert.throws(() => opening.writeOpeningMessage('一\n二\n三'), /最多两行/)
  assert.throws(() => opening.writeOpeningMessage('豹'.repeat(81)), /最多80个字/)
})
