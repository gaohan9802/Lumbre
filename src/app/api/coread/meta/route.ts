export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { updateBookMeta } from '@/server/coread-store'
export async function POST(req: NextRequest) {
  try {
    const { bookId, ...patch } = await req.json()
    if (!bookId) return NextResponse.json({ error: 'missing bookId' }, { status: 400 })
    const book = updateBookMeta(bookId, patch)
    return book ? NextResponse.json({ success: true, book }) : NextResponse.json({ error: 'not_found' }, { status: 404 })
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
