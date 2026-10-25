import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import AdmZip from 'adm-zip'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-coread-'))
process.env.DATA_DIR = root

let media: typeof import('../../src/server/media-library-store')
let coread: typeof import('../../src/server/coread-store')
before(async () => {
  media = await import('../../src/server/media-library-store')
  coread = await import('../../src/server/coread-store')
})
after(() => rmSync(root, { recursive: true, force: true }))

function epub(): Buffer {
  const zip = new AdmZip()
  zip.addFile('mimetype', Buffer.from('application/epub+zip'))
  zip.addFile('META-INF/container.xml', Buffer.from('<?xml version="1.0"?><container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>'))
  zip.addFile('OPS/content.opf', Buffer.from('<package><manifest><item id="c1" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>'))
  zip.addFile('OPS/chapter.xhtml', Buffer.from('<html><head><title>第一章</title></head><body><h1>第一章</h1><p>风从窗外吹进来。</p><p>这是第二段。</p></body></html>'))
  return zip.toBuffer()
}

test('EPUB import keeps independent progress and actor-owned annotations', async () => {
  const work = media.saveMediaEntry('star', { kind: 'book', title: '一起读', status: 'planned', coread_request: true, coread_note: '想和小火读' })
  assert.equal(work.coread?.status, 'requested')
  const book = await coread.importCoreadDocument('fire', work.id, { name: '一起读.epub', bytes: epub() })
  assert.equal(book.chapters[0].title, '第一章')
  assert.equal(book.paragraphs.filter(item => item.text === '第一章').length, 1)
  assert.match(book.paragraphs.map(item => item.text).join('\n'), /风从窗外吹进来/)

  coread.updateCoreadProgress('fire', work.id, 1)
  coread.updateCoreadProgress('star', work.id, 0)
  const slice = coread.readCoread(work.id, { actor: 'fire' })
  assert.equal(slice.progress.fire?.paragraph_idx, 1)
  assert.equal(slice.progress.star?.paragraph_idx, 0)
  const offline = coread.readCoreadOffline(work.id)
  assert.equal(offline.book.checksum.length, 64)
  assert.equal(offline.book.paragraphs.length, book.paragraphs.length)

  const newer = coread.updateCoreadProgress('fire', work.id, 0)
  const rejected = coread.updateCoreadProgress('fire', work.id, 1, 0, new Date(Date.now() - 60_000).toISOString())
  assert.deepEqual(rejected, newer)

  const paragraph = book.paragraphs.find(item => item.text.includes('风从'))!
  const note = coread.writeCoreadAnnotation('fire', work.id, { paragraph_idx: paragraph.idx, start_offset: 0, end_offset: 2, content: '喜欢这里' })
  const reply = coread.writeCoreadAnnotation('star', work.id, { reply_to: note.id, content: '我也喜欢' })
  assert.equal(reply.selected_text, '风从')
  assert.equal(coread.readCoreadAnnotations(work.id).length, 2)
  coread.writeCoreadAnnotation('fire', work.id, { annotation_id: note.id, content: '改成新的批注' })
  assert.equal(media.listMediaTimeline().find(item => item.target_id === note.id)?.detail, '改成新的批注')
  assert.equal(coread.deleteCoreadAnnotation('fire', work.id, note.id), 'has_replies')
  assert.equal(coread.deleteCoreadAnnotation('star', work.id, reply.id), 'ok')
  assert.equal(coread.deleteCoreadAnnotation('fire', work.id, note.id), 'ok')
})

test('a deleted work can remove its reader files', async () => {
  const work = media.saveMediaEntry('fire', { kind: 'book', title: '会被删除', status: 'planned', coread_request: true })
  await coread.importCoreadDocument('fire', work.id, { name: '会被删除.txt', bytes: Buffer.from('第一段。\n\n第二段。') })
  assert.equal(media.deleteMediaContent('fire', { type: 'work', work_id: work.id }), 'ok')
  coread.deleteCoreadDocument(work.id)
  assert.throws(() => coread.readCoreadOffline(work.id))
})

test('PDF uploads are rejected without loading a server PDF renderer', async () => {
  const work = media.saveMediaEntry('fire', { kind: 'book', title: 'PDF', status: 'planned', coread_request: true })
  await assert.rejects(
    coread.importCoreadDocument('fire', work.id, { name: 'book.pdf', bytes: Buffer.from('%PDF-1.7') }),
    /只支持 EPUB 或 TXT 文件/,
  )
})
