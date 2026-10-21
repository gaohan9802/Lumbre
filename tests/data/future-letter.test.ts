import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-future-letter-'))
process.env.DATA_DIR = root

let store: typeof import('../../src/server/future-letter-store')

before(async () => { store = await import('../../src/server/future-letter-store') })
after(() => rmSync(root, { recursive: true, force: true }))

test('future letter appends idempotent stable paragraphs and edits by id', () => {
  const first = store.appendFutureLetterParagraph('第一段，留给醒来的自己。', 'message-1-letter-1')
  assert.equal(first.deduplicated, false)
  assert.match(first.paragraph.id, /^p-[a-z0-9]+-[a-f0-9]{6}$/)

  const repeated = store.appendFutureLetterParagraph('不会重复写入', 'message-1-letter-1')
  assert.equal(repeated.deduplicated, true)
  assert.equal(repeated.paragraph.id, first.paragraph.id)
  assert.equal(store.readFutureLetter().paragraphs.length, 1)

  const edited = store.editFutureLetterParagraph(first.paragraph.id, '第一段，已经重新想过。')
  assert.equal(edited.id, first.paragraph.id)
  assert.equal(edited.content, '第一段，已经重新想过。')
  assert.equal(store.readFutureLetter().paragraphs[0].content, edited.content)
})

test('future letter rejects empty paragraphs and unknown ids', () => {
  assert.throws(() => store.appendFutureLetterParagraph(' ', 'message-2'), /不能为空/)
  assert.throws(() => store.editFutureLetterParagraph('missing', '新的内容'), /没有找到/)
})
