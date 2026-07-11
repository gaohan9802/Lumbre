import { NextRequest, NextResponse } from 'next/server'
import { commentThesis } from '@/server/thesis-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  const r = commentThesis(b.author || 'fire', b.content || '')
  return NextResponse.json({ ok: r === 'ok', result: r })
}
