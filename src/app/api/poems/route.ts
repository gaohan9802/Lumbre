import { NextRequest, NextResponse } from 'next/server'
import { appendPoemLine, createPoem, deletePoem, deletePoemLine, editPoemLine, getPoem, listPoems, updatePoem, type PoemAuthor } from '@/server/poem-store'

export const dynamic = 'force-dynamic'
const actor = (value: unknown): PoemAuthor => value === 'star' ? 'star' : 'fire'

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  try { return NextResponse.json(id ? { poem: getPoem(id) } : { poems: listPoems(request.nextUrl.searchParams.get('archived') === '1') }) }
  catch (error: any) { return NextResponse.json({ error: error?.message || 'poem_error' }, { status: 404 }) }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const who = actor(body.actor)
    if (body.action === 'create') return NextResponse.json({ ok: true, poem: createPoem(body.title) })
    if (body.action === 'append') return NextResponse.json({ ok: true, poem: appendPoemLine(body.id, who, body.text) })
    if (body.action === 'edit_line') return NextResponse.json({ ok: true, poem: editPoemLine(body.id, body.line_id, who, body.text) })
    if (body.action === 'rename') return NextResponse.json({ ok: true, poem: updatePoem(body.id, { title: body.title }) })
    if (body.action === 'archive') return NextResponse.json({ ok: true, poem: updatePoem(body.id, { archived: body.archived !== false }) })
    if (body.action === 'delete_line') return NextResponse.json({ ok: true, poem: deletePoemLine(body.id, body.line_id, who) })
    if (body.action === 'delete') return NextResponse.json({ ok: deletePoem(body.id) })
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'poem_error' }, { status: 400 })
  }
}
