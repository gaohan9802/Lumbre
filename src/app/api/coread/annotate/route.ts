export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { addAnnotation, deleteAnnotation, getAnnotations } from '@/server/coread-store'

// POST /api/coread/annotate — add or delete an annotation
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, bookId, chapterNum, originalText, annotation, annId, kind, color, annotator } = body

    if (action === 'delete') {
      if (!bookId || !annId) return NextResponse.json({ error: 'missing params' }, { status: 400 })
      const ok = deleteAnnotation(bookId, annId)
      return NextResponse.json({ success: ok })
    }

    // Default: add
    if (!bookId || chapterNum === undefined || (!annotation && kind !== 'highlight' && kind !== 'bookmark')) {
      return NextResponse.json({ error: 'missing params' }, { status: 400 })
    }
    const ann = addAnnotation(bookId, chapterNum, originalText || '', annotation, annotator === 'ai' ? 'ai' : 'user', kind || 'comment', color || '')
    if (!ann) return NextResponse.json({ error: '添加失败' }, { status: 400 })
    return NextResponse.json({ success: true, annotation: ann })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
