import { NextRequest, NextResponse } from 'next/server'
import { editPhoto } from '@/server/photo-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  const patch: { caption?: string; locked?: boolean; albumId?: string } = {}
  if (typeof b.caption === 'string') patch.caption = b.caption
  if (typeof b.locked === 'boolean') patch.locked = b.locked
  if (typeof b.album_id === 'string') patch.albumId = b.album_id
  try {
    const r = editPhoto(b.id, patch)
    return NextResponse.json({ ok: r === 'ok', result: r })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'photo edit failed' }, { status: 400 })
  }
}
