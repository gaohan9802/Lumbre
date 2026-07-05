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
    const formData = await req.formData()
    const preserveRaw = req.nextUrl.searchParams.get('preserve_raw') || '0'
    const res = await fetch(
      `${BRAIN_API}/api/import/upload?preserve_raw=${preserveRaw}`,
      {
        method: 'POST',
        headers: { Cookie: cookie },
        body: formData,
      }
    )
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
