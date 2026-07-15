export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getChapter, getAnnotations, updateProgress } from '@/server/coread-store'

// POST /api/coread/chapter — get chapter content + annotations
// Body: { bookId, chapterNum }
export async function POST(req: NextRequest) {
  try {
    const { bookId, chapterNum } = await req.json()
    if (!bookId || chapterNum === undefined) {
      return NextResponse.json({ error: 'missing bookId or chapterNum' }, { status: 400 })
    }

    const chapter = getChapter(bookId, chapterNum)
    if (!chapter) {
      return NextResponse.json({ error: '章节不存在' }, { status: 404 })
    }

    // Update reading progress
    updateProgress(bookId, chapterNum)

    // Get annotations for this chapter
    const annotations = getAnnotations(bookId, chapterNum)

    return NextResponse.json({
      chapter: {
        chapterNum: chapter.chapterNum,
        title: chapter.title,
        content: chapter.content,
        digest: chapter.digest,
      },
      annotations,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
