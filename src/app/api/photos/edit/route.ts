import { NextRequest, NextResponse } from 'next/server'
import { editPhoto } from '@/server/photo-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  const patch: { caption?: string; locked?: boolean } = {}
  if (typeof b.caption === 'string') patch.caption = b.caption
  if (typeof b.locked === 'boolean') patch.locked = b.locked
  const r = editPhoto(b.id, patch)
  return NextResponse.json({ ok: r === 'ok', result: r })
}
