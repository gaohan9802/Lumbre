import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-media-library-'))
process.env.DATA_DIR = root

let store: typeof import('../../src/server/media-library-store')
before(async () => { store = await import('../../src/server/media-library-store') })
after(() => rmSync(root, { recursive: true, force: true }))

test('two people keep separate records while sharing notes and timeline', () => {
  const work = store.saveMediaEntry('fire', { kind: 'book', title: '城与城', creators: ['柴纳·米耶维'], status: 'in_progress', rating: 4 })
  store.saveMediaEntry('star', { work_id: work.id, status: 'planned', review: '想和小火一起读' })
  const note = store.writeMediaNote('fire', work.id, { type: 'quote', content: '一段摘抄', locator: '第 12 页' })
  const noteEvent = store.listMediaTimeline().find(item => item.target_id === note.id)!
  store.commentMediaEvent('star', work.id, noteEvent.id, '我也喜欢这句')

  const saved = store.getMediaWork(work.id)!
  assert.equal(saved.records.fire?.status, 'in_progress')
  assert.equal(saved.records.star?.status, 'planned')
  assert.equal(saved.notes[0].locator, '第 12 页')
  assert.equal(saved.events.find(item => item.id === noteEvent.id)?.comments[0].author, 'star')

  assert.equal(store.deleteMediaContent('fire', { type: 'record', work_id: work.id }), 'ok')
  const remaining = store.getMediaWork(work.id)!
  assert.equal(remaining.records.fire, undefined)
  assert.equal(remaining.records.star?.status, 'planned')
  assert.equal(remaining.notes.length, 0)
})
