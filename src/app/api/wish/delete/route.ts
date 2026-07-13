import { NextRequest, NextResponse } from 'next/server'
import { deleteWish } from '@/server/wish-store'

export async function POST(req: NextRequest) {
  const b = await req.json()
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const r = deleteWish(b.id)
  return NextResponse.json({ ok: r === 'ok', result: r })
}
