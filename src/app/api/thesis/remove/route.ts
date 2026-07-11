import { NextRequest, NextResponse } from 'next/server'
import { removeChapter } from '@/server/thesis-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  const r = removeChapter(b.id)
  return NextResponse.json({ ok: r === 'ok', result: r })
}
