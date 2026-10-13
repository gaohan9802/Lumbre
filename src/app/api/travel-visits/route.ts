import { NextRequest, NextResponse } from 'next/server'
import { getPhotoAlbum } from '@/server/photo-store'
import { deleteTravelVisit, listTravelVisits, saveTravelVisit } from '@/server/travel-visit-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ visits: listTravelVisits() })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (body.action === 'save') {
      if (body.visit?.album_id) {
        const album = getPhotoAlbum(body.visit.album_id)
        if (!album || album.zone !== 'travel') return NextResponse.json({ error: '关联的旅行相册不存在' }, { status: 400 })
      }
      return NextResponse.json({ ok: true, visit: saveTravelVisit(body.visit || {}) })
    }
    if (body.action === 'delete') return NextResponse.json({ ok: deleteTravelVisit(String(body.id || '')) })
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '旅行足迹保存失败' }, { status: 400 })
  }
}
