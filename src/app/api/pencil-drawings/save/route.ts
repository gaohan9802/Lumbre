import { NextRequest, NextResponse } from 'next/server'
import { savePencilDrawingToPhoto } from '@/server/data/repositories/pencil-drawings'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (typeof body?.id !== 'string') return NextResponse.json({ error: 'drawing id required' }, { status: 400 })
    const saved = savePencilDrawingToPhoto(body.id, typeof body.album_id === 'string' ? body.album_id : undefined)
    return NextResponse.json({ ok: true, id: saved.photo.id, already_saved: saved.already_saved })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'save failed' }, { status: 400 })
  }
}
