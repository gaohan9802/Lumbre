import { NextRequest, NextResponse } from 'next/server'
import { updateChapter } from '@/server/thesis-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: { title?: string; totalPages?: number; currentPages?: number } = {}
  if (typeof b.title === 'string') patch.title = b.title
  if (b.totalPages != null) patch.totalPages = Number(b.totalPages)
  if (b.currentPages != null) patch.currentPages = Number(b.currentPages)
  const r = updateChapter(b.id, patch)
  return NextResponse.json({ ok: r === 'ok', result: r })
}
