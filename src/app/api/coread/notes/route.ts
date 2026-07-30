export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { readCoreadNotes, writeCoreadNote } from '@/server/coread-store'

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams
    return NextResponse.json({ notes: readCoreadNotes({
      bookId: p.get('bookId') || undefined, bookTitle: p.get('bookTitle') || undefined,
      date: p.get('date') || undefined, author: (p.get('author') as any) || undefined,
      limit: Number(p.get('limit')) || 50,
    }) })
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.content?.trim()) return NextResponse.json({ error: '缺少内容' }, { status: 400 })
    return NextResponse.json({ success: true, note: writeCoreadNote(body) })
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }) }
}
