import { NextRequest, NextResponse } from 'next/server'
import { updateUserContext } from '@/server/tools'

// Server-side proxy: open-meteo (weather, no key) + bigdatacloud (reverse geocode, no key)
// Also caches the location for AI tools (get_weather, get_location)
export async function POST(req: NextRequest) {
  try {
    const { lat, lon } = await req.json()
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return NextResponse.json({ error: 'lat/lon required' }, { status: 400 })
    }
    const [wRes, gRes, nRes] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`),
      fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`),
      // OpenStreetMap Nominatim: street-level reverse geocode (road + house number).
      // Free, no key; requires a descriptive User-Agent.
      fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=zh`, {
        headers: { 'User-Agent': 'Lumbre/1.0 (https://lumbre.zeabur.app)' },
      }).catch(() => null),
    ])
    const w = await wRes.json().catch(() => ({}))
    const g = await gRes.json().catch(() => ({}))
    const nom = nRes ? await nRes.json().catch(() => ({})) : {}

    const temp = w?.current?.temperature_2m ?? null
    const code = w?.current?.weather_code ?? 0

    const na = nom?.address || {}
    const road = na.road || na.pedestrian || na.footway || na.neighbourhood || ''
    const houseNumber = na.house_number || ''
    const city = na.city || na.town || na.village || na.county
      || g?.city || g?.locality || g?.principalSubdivision || ''
    const address = nom?.display_name || [road, houseNumber, city].filter(Boolean).join(' ') || ''

    // Cache for AI tools
    updateUserContext({ lat, lon, temp, weatherCode: code, city, road, houseNumber, address })

    return NextResponse.json({ temp, code, city, road, houseNumber, address })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
