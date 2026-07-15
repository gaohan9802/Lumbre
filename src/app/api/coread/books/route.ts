export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { listBooks, getChapterList } from '@/server/coread-store'

// GET /api/coread/books — list all books
export async function GET() {
  try {
    const books = listBooks()
    return NextResponse.json({ books })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// POST /api/coread/books — get chapter list for a book
export async function POST(req: NextRequest) {
  try {
    const { bookId } = await req.json()
    if (!bookId) return NextResponse.json({ error: 'missing bookId' }, { status: 400 })
    const chapters = getChapterList(bookId)
    return NextResponse.json({ chapters })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
