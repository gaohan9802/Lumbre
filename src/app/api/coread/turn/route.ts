export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { addChatMessage, extractAnnotations, getBook, getChapter } from '@/server/coread-store'

export async function POST(req: NextRequest) {
  try {
    const { bookId, chapterNum, role, content } = await req.json()
    if (!bookId || chapterNum == null || !content?.trim()) return NextResponse.json({ error: 'missing params' }, { status: 400 })
    const book = getBook(bookId)
    const chapter = getChapter(bookId, Number(chapterNum))
    if (!book || !chapter) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    let text = String(content).slice(0, 10000)
    let annotations = 0
    if (role === 'assistant') {
      const extracted = extractAnnotations(text, bookId, Number(chapterNum), chapter.content)
      text = extracted.text
      annotations = extracted.count
    }
    addChatMessage(bookId, Number(chapterNum), role === 'assistant' ? 'ai' : 'user', text)
    return NextResponse.json({ success: true, annotations })
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
