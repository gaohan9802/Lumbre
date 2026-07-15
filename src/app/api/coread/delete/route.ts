export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { deleteBook } from '@/server/coread-store'

// POST /api/coread/delete — delete a book
export async function POST(req: NextRequest) {
  try {
    const { bookId } = await req.json()
    if (!bookId) return NextResponse.json({ error: 'missing bookId' }, { status: 400 })
    const ok = deleteBook(bookId)
    return NextResponse.json({ success: ok })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
