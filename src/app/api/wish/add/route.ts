import { NextRequest, NextResponse } from 'next/server'
import { addWish } from '@/server/wish-store'

export async function POST(req: NextRequest) {
  const b = await req.json()
  if (!b.title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })
  const wish = addWish(b.author || 'fire', b.title.trim(), { desc: b.desc, priority: b.priority })
  return NextResponse.json({ ok: true, wish })
}
