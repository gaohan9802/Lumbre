import { NextRequest, NextResponse } from 'next/server'
import { commentWish } from '@/server/wish-store'

export async function POST(req: NextRequest) {
  const b = await req.json()
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const r = commentWish(b.id, b.author || 'fire', b.content || '')
  return NextResponse.json({ ok: r === 'ok', result: r })
}
