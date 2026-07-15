export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { importBook, importTextWithSplit } from '@/server/coread-store'

// POST /api/coread/import — import a book
// Body: { type: 'text'|'epub', title, author, content?, chapters? }
// For epub: chapters is pre-parsed array [{title, content}]
// For text: content is plain text string
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { type, title, author, content, chapters } = body

    if (!title) return NextResponse.json({ error: '缺少书名' }, { status: 400 })

    if (type === 'chapters' && Array.isArray(chapters) && chapters.length > 0) {
      // Pre-parsed chapters (from frontend epub parsing or manual split)
      const book = importBook(title, author || '', chapters)
      return NextResponse.json({ success: true, book, chapterCount: chapters.length })
    }

    if (content && typeof content === 'string') {
      // Plain text with auto-splitting
      const book = importTextWithSplit(title, author || '', content)
      return NextResponse.json({ success: true, book })
    }

    return NextResponse.json({ error: '需要 content(文本) 或 chapters(章节数组)' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
