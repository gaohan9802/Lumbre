import { NextRequest, NextResponse } from 'next/server'

const DIARY_API = process.env.DIARY_API_BASE || 'https://starfire-diary.zeabur.app'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const params = new URLSearchParams()
    if (body.keyword) params.set('keyword', body.keyword)
    if (body.limit) params.set('limit', String(body.limit))
    const qs = params.toString()
    const url = `${DIARY_API}/api/notes/list${qs ? '?' + qs : ''}`
    const res = await fetch(url, { method: 'GET' })
    const data = await res.json()
    // Backend returns array directly
    if (Array.isArray(data)) {
      return NextResponse.json({ notes: data })
    }
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
