import { NextRequest, NextResponse } from 'next/server'
import { writePhoto } from '@/server/photo-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  if (!b.url) return NextResponse.json({ error: 'url required' }, { status: 400 })
  const photo = writePhoto({ author: b.author || 'fire', url: b.url, caption: b.caption, source: b.source, locked: b.locked || false })
  return NextResponse.json({ ok: true, id: photo.id })
}
