import { NextRequest, NextResponse } from 'next/server'
import { listPhotoPage, type PhotoZone } from '@/server/photo-store'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get('zone')
  const legacyLocked = req.nextUrl.searchParams.get('locked')
  const zone: PhotoZone = requested === 'travel' || requested === 'locked' || requested === 'wall'
    ? requested : legacyLocked === 'true' ? 'locked' : 'wall'
  const page = listPhotoPage({
    zone,
    albumId: req.nextUrl.searchParams.get('album_id') || undefined,
    cursor: req.nextUrl.searchParams.get('cursor') || undefined,
    limit: Number(req.nextUrl.searchParams.get('limit')) || 24,
  })
  const photos = page.photos.map(p => ({
    ...p,
    url: p.url?.startsWith('data:') ? `/api/photos/raw/${p.id}` : p.url,
    thumbnail_url: `/api/photos/thumb/${p.id}`,
  }))
  return NextResponse.json({ photos, next_cursor: page.next_cursor })
}
