import { NextRequest, NextResponse } from 'next/server'
import { MEDIA_KINDS, MEDIA_STATUSES, type MediaActor, type MediaKind, type MediaStatus } from '@/lib/media-library'
import { importDoubanBook, readDoubanCover, readTmdbDetails, searchMediaCatalog } from '@/server/media-catalog'
import {
  commentMediaEvent, deleteMediaContent, getMediaWork, listMediaLibrary, listMediaTimeline,
  saveMediaEntry, writeMediaNote, type DeleteMediaTarget,
} from '@/server/media-library-store'
import { deleteCoreadAnnotation, importCoreadDocument, readCoread, readCoreadProgress, updateCoreadProgress, writeCoreadAnnotation } from '@/server/coread-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const actor = (value: unknown): MediaActor => value === 'star' ? 'star' : 'fire'

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams
  const mode = search.get('mode') || 'list'
  try {
    if (mode === 'timeline') return NextResponse.json({ events: listMediaTimeline(Number(search.get('limit')) || 100) })
    if (mode === 'detail') {
      const work = getMediaWork(search.get('id') || '')
      return work ? NextResponse.json({ work }) : NextResponse.json({ error: 'not found' }, { status: 404 })
    }
    if (mode === 'search') {
      const kind = MEDIA_KINDS.includes(search.get('kind') as MediaKind) ? search.get('kind') as MediaKind : 'book'
      return NextResponse.json(await searchMediaCatalog(kind, search.get('q') || ''))
    }
    if (mode === 'import-url') return NextResponse.json({ item: await importDoubanBook(search.get('url') || '') })
    if (mode === 'douban-cover') {
      const cover = await readDoubanCover(search.get('id') || '', search.get('url') || '')
      const body = cover.bytes.buffer.slice(cover.bytes.byteOffset, cover.bytes.byteOffset + cover.bytes.byteLength) as ArrayBuffer
      return new NextResponse(body, { headers: { 'Content-Type': cover.type, 'Cache-Control': 'private, max-age=31536000, immutable' } })
    }
    if (mode === 'catalog-detail') {
      const kind = search.get('kind')
      if (kind !== 'movie' && kind !== 'tv') return NextResponse.json({ error: 'invalid kind' }, { status: 400 })
      return NextResponse.json({ item: await readTmdbDetails(kind, search.get('id') || '') })
    }
    if (mode === 'coread') return NextResponse.json(readCoread(search.get('work_id') || '', {
      actor: actor(search.get('actor')),
      start: search.has('start') ? Number(search.get('start')) : undefined,
      chapter_id: search.get('chapter_id') || undefined,
      limit: Number(search.get('limit')) || undefined,
    }))
    const kind = MEDIA_KINDS.includes(search.get('kind') as MediaKind) ? search.get('kind') as MediaKind : undefined
    const status = MEDIA_STATUSES.includes(search.get('status') as MediaStatus) ? search.get('status') as MediaStatus : undefined
    const owner = search.get('owner') === 'fire' || search.get('owner') === 'star' ? search.get('owner') as MediaActor : undefined
    const result = listMediaLibrary({ kind, status, owner, query: search.get('q') || undefined, coread: search.get('coread') === '1' })
    return NextResponse.json(search.get('coread') === '1'
      ? { works: result.works.map(work => ({ ...work, coread_progress: readCoreadProgress(work.id) })) }
      : result)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'request failed' }, { status: 400 })
  }
}
export async function POST(req: NextRequest) {
  try {
    if (req.nextUrl.searchParams.get('mode') === 'coread-upload') {
      const form = await req.formData()
      const upload = form.get('file')
      if (!(upload instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
      const who = actor(form.get('actor'))
      const book = await importCoreadDocument(who, String(form.get('work_id') || ''), { name: upload.name, bytes: Buffer.from(await upload.arrayBuffer()) })
      return NextResponse.json({ ok: true, book: { file_name: book.file_name, format: book.format, chapters: book.chapters, paragraph_count: book.paragraphs.length } })
    }
    const body = await req.json()
    const who = actor(body.actor)
    if (body.action === 'save') return NextResponse.json({ ok: true, work: saveMediaEntry(who, body.entry || {}) })
    if (body.action === 'note') return NextResponse.json({ ok: true, note: writeMediaNote(who, String(body.work_id || ''), body.note || {}) })
    if (body.action === 'comment') return NextResponse.json({ ok: true, comment: commentMediaEvent(who, String(body.work_id || ''), String(body.event_id || ''), body.content) })
    if (body.action === 'coread_progress') return NextResponse.json({ ok: true, progress: updateCoreadProgress(who, String(body.work_id || ''), body.paragraph_idx, body.offset) })
    if (body.action === 'coread_annotation') return NextResponse.json({ ok: true, annotation: writeCoreadAnnotation(who, String(body.work_id || ''), body.annotation || {}) })
    if (body.action === 'coread_delete_annotation') {
      const result = deleteCoreadAnnotation(who, String(body.work_id || ''), String(body.annotation_id || ''))
      return NextResponse.json({ ok: result === 'ok', result }, { status: result === 'ok' ? 200 : result === 'not_found' ? 404 : 409 })
    }
    if (body.action === 'delete') {
      const result = deleteMediaContent(who, body.target as DeleteMediaTarget)
      return NextResponse.json({ ok: result === 'ok', result }, { status: result === 'ok' ? 200 : result === 'not_found' ? 404 : 409 })
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'request failed' }, { status: 400 })
  }
}
