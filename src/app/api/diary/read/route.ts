import { NextRequest, NextResponse } from 'next/server'

const DIARY_API = process.env.DIARY_API_BASE || 'https://starfire-diary.zeabur.app'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const params = new URLSearchParams()
    if (body.viewer) params.set('viewer', body.viewer)
    if (body.keyword) params.set('keyword', body.keyword)
    if (body.author_filter) params.set('author_filter', body.author_filter)
    if (body.target_date) params.set('target_date', body.target_date)
    const qs = params.toString()
    const url = `${DIARY_API}/api/diary/list${qs ? '?' + qs : ''}`
    const res = await fetch(url, { method: 'GET' })
    const data = await res.json()
    if (Array.isArray(data)) {
      return NextResponse.json({ entries: data })
    }
    return NextResponse.json(data)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
