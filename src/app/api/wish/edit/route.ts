import { NextRequest, NextResponse } from 'next/server'
import { editWish } from '@/server/wish-store'

export async function POST(req: NextRequest) {
  const b = await req.json()
  if (!b.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const patch: { title?: string; desc?: string; priority?: any; status?: any } = {}
  if (typeof b.title === 'string') patch.title = b.title
  if (typeof b.desc === 'string') patch.desc = b.desc
  if (b.priority) patch.priority = b.priority
  if (b.status) patch.status = b.status
  const r = editWish(b.id, patch)
  return NextResponse.json({ ok: r === 'ok', result: r })
}
