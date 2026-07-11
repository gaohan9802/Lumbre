import { NextRequest, NextResponse } from 'next/server'
import { addChapter } from '@/server/thesis-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  if (!b.title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })
  const chapter = addChapter(b.title.trim(), Number(b.totalPages) || 0)
  return NextResponse.json({ ok: true, chapter })
}
