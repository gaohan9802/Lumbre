import { NextRequest, NextResponse } from 'next/server'

const DIARY_API = process.env.DIARY_API_BASE || 'https://starfire-diary.zeabur.app'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const params = new URLSearchParams()
    if (body.author) params.set('author', body.author)
    if (body.target_date) params.set('target_date', body.target_date)
    if (body.time_id) params.set('time_id', body.time_id)
    const url = `${DIARY_API}/api/diary/delete?${params.toString()}`
    const res = await fetch(url, { method: 'POST' })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
