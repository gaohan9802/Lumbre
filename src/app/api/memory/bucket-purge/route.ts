import { NextRequest, NextResponse } from 'next/server'

const BRAIN_API = process.env.BRAIN_API_BASE || 'https://xiaohuo.zeabur.app'
const BRAIN_PWD = process.env.BRAIN_PASSWORD || '980228'

let sessionCookie = ''
async function ensureSession(): Promise<string> {
  if (sessionCookie) {
    try {
      const r = await fetch(`${BRAIN_API}/auth/status`, { headers: { Cookie: sessionCookie } })
      const d = await r.json()
      if (d.authenticated) return sessionCookie
    } catch {}
  }
  const r = await fetch(`${BRAIN_API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: BRAIN_PWD }),
  })
  const sc = r.headers.get('set-cookie')
  if (sc) sessionCookie = sc.split(';')[0]
  return sessionCookie
}

export async function POST(req: NextRequest) {
  try {
    const cookie = await ensureSession()
    const body = await req.json()
    const res = await fetch(`${BRAIN_API}/api/buckets/purge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
        'X-Purge-Confirm': 'dashboard-purge-v1',
      },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    try {
      return NextResponse.json(JSON.parse(text), { status: res.status })
    } catch {
      return new NextResponse(text, { status: res.status })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
