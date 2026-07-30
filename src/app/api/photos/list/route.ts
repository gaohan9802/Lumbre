import { NextRequest, NextResponse } from 'next/server'
import { listPhotos } from '@/server/photo-store'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const locked = req.nextUrl.searchParams.get('locked')
  const opts: { locked?: boolean } = {}
  if (locked === 'true') opts.locked = true
  else if (locked === 'false') opts.locked = false
  const photos = listPhotos(opts)
  // Replace base64 dataUrl with a lightweight http reference to improve load speed
  const lite = photos.map(p => ({
    ...p,
    url: p.url?.startsWith('data:') ? `/api/photos/raw/${p.id}` : p.url,
  }))
  return NextResponse.json({ photos: lite }, {
    headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=30' }
  })
}
