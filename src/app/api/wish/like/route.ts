import { NextRequest, NextResponse } from 'next/server'
import { likeWish } from '@/server/wish-store'

export async function POST(req: NextRequest) {
  const b = await req.json()
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const r = likeWish(b.id, b.author || 'fire')
  return NextResponse.json({ ok: r === 'ok', result: r })
}
