import { NextRequest, NextResponse } from 'next/server'
import { cacheTravelPlaces, claimTravelGeocode, readCachedTravelPlaces } from '@/server/travel-visit-store'
import type { TravelPlaceResult } from '@/lib/travel-map'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const query = String(req.nextUrl.searchParams.get('q') || '').trim().replace(/\s+/g, ' ').slice(0, 120)
  if (query.length < 2) return NextResponse.json({ error: '请至少输入两个字' }, { status: 400 })
  const key = query.toLocaleLowerCase()
  const cached = readCachedTravelPlaces(key)
  if (cached) return NextResponse.json({ results: cached, cached: true })
  if (!claimTravelGeocode()) return NextResponse.json({ error: '地点查询太快啦，请等一秒再试' }, { status: 429 })

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search')
    url.searchParams.set('q', query)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('addressdetails', '1')
    url.searchParams.set('accept-language', 'zh-CN')
    url.searchParams.set('limit', '5')
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Lumbre-Private-Travel-Map/1.0 (https://xsidereal.beer)', Referer: 'https://xsidereal.beer/' },
      signal: AbortSignal.timeout(8000),
    })
    if (!response.ok) throw new Error(`地点服务暂时不可用 (${response.status})`)
    const rows = await response.json() as Array<Record<string, unknown>>
    const results: TravelPlaceResult[] = rows.flatMap(row => {
      const lat = Number(row.lat); const lon = Number(row.lon); const address = String(row.display_name || '').trim()
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !address) return []
      return [{
        place_id: `${String(row.osm_type || 'place')}:${String(row.osm_id || `${lat},${lon}`)}`,
        name: address.split(',')[0].trim(), address, lat, lon,
      }]
    })
    cacheTravelPlaces(key, results)
    return NextResponse.json({ results, cached: false })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '地点查询失败' }, { status: 502 })
  }
}
