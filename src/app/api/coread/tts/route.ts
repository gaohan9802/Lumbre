export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { text, voice = 'alloy', speed = 1, api_profile } = await req.json()
    if (!text?.trim() || !api_profile?.apiKey || !api_profile?.baseUrl) return NextResponse.json({ error: 'missing voice API config' }, { status: 400 })
    const base = String(api_profile.baseUrl).replace(/\/$/, '')
    const res = await fetch(`${base}/audio/speech`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api_profile.apiKey}` },
      body: JSON.stringify({ model: api_profile.ttsModel || 'tts-1', voice, speed: Math.max(.25, Math.min(4, Number(speed) || 1)), input: String(text).slice(0, 12000) }),
    })
    if (!res.ok) return NextResponse.json({ error: (await res.text()).slice(0, 300) }, { status: res.status })
    return new Response(res.body, { headers: { 'Content-Type': res.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'no-store' } })
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
