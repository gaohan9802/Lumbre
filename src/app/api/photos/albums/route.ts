import { NextRequest, NextResponse } from 'next/server'
import { createPhotoAlbum, deletePhotoAlbum, listPhotoAlbums, renamePhotoAlbum, type PhotoZone } from '@/server/photo-store'

export async function GET(req: NextRequest) {
  const requested = req.nextUrl.searchParams.get('zone')
  const zone = ['wall', 'travel', 'locked'].includes(String(requested)) ? requested as PhotoZone : undefined
  return NextResponse.json({ albums: listPhotoAlbums(zone) })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  try {
    if (body.action === 'create') return NextResponse.json({ ok: true, album: createPhotoAlbum(body.name || '', body.zone) })
    if (body.action === 'rename') return NextResponse.json({ ok: true, album: renamePhotoAlbum(body.id, body.name || '') })
    if (body.action === 'delete') {
      const result = deletePhotoAlbum(body.id)
      return NextResponse.json({ ok: result === 'ok', result }, { status: result === 'ok' ? 200 : 409 })
    }
    return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'album update failed' }, { status: 400 })
  }
}
