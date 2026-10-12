import { NextRequest, NextResponse } from 'next/server'
import { writePhoto } from '@/server/photo-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  if (!b.url) return NextResponse.json({ error: 'url required' }, { status: 400 })
  try {
    const photo = writePhoto({ author: b.author || 'fire', url: b.url, caption: b.caption, source: b.source, locked: b.locked || false, zone: b.zone, albumId: b.album_id })
    return NextResponse.json({ ok: true, photo: { ...photo, thumbnail_url: `/api/photos/thumb/${photo.id}` } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'photo write failed' }, { status: 400 })
  }
}
