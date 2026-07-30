export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { updateProgress } from '@/server/coread-store'
export async function POST(req: NextRequest) {
  try {
    const { bookId, chapterNum, progress } = await req.json()
    if (!bookId || chapterNum == null) return NextResponse.json({ error: 'missing params' }, { status: 400 })
    updateProgress(bookId, Number(chapterNum), Number(progress) || 0)
    return NextResponse.json({ success: true })
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
