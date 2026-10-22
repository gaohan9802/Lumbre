import { NextRequest, NextResponse } from 'next/server'
import { createFireDictionaryEntry, deleteFireDictionaryEntry, readFireDictionary, updateFireDictionaryEntry } from '@/server/fire-dictionary-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams
  return NextResponse.json({ entries: readFireDictionary({ query: query.get('q'), letter: query.get('letter') }) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const actor = body.actor === 'star' ? 'star' : 'fire'
    if (body.action === 'create') return NextResponse.json({ entry: createFireDictionaryEntry(actor, body.entry) })
    if (body.action === 'update') return NextResponse.json({ entry: updateFireDictionaryEntry(actor, body.id, body.patch || {}) })
    if (body.action === 'delete') return NextResponse.json({ deleted: deleteFireDictionaryEntry(body.id) })
    return NextResponse.json({ error: '未知操作' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '操作失败' }, { status: 400 })
  }
}
