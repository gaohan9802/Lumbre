import { NextRequest, NextResponse } from 'next/server'

// Server-side proxy: open-meteo (weather, no key) + bigdatacloud (reverse geocode, no key)
export async function POST(req: NextRequest) {
  try {
    const { lat, lon } = await req.json()
    if (typeof lat !== 'number' || typeof lon !== 'number') {
      return NextResponse.json({ error: 'lat/lon required' }, { status: 400 })
    }
    const [wRes, gRes] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`),
      fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=zh`),
    ])
    const w = await wRes.json().catch(() => ({}))
    const g = await gRes.json().catch(() => ({}))
    return NextResponse.json({
      temp: w?.current?.temperature_2m ?? null,
      code: w?.current?.weather_code ?? 0,
      city: g?.city || g?.locality || g?.principalSubdivision || '',
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
