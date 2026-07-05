/**
 * Server-side proxy helper for Ombre Brain.
 * Handles auth session cookies and multiple HTTP methods.
 */
import { NextRequest, NextResponse } from 'next/server'

const BRAIN_API = process.env.BRAIN_API_BASE || 'https://xiaohuo.zeabur.app'
const BRAIN_PWD = process.env.BRAIN_PASSWORD || '980228'

let sessionCookie = ''

async function ensureSession(): Promise<string> {
  if (sessionCookie) {
    try {
      const r = await fetch(`${BRAIN_API}/auth/status`, {
        headers: { Cookie: sessionCookie },
      })
      const d = await r.json()
      if (d.authenticated) return sessionCookie
    } catch { /* fall through to re-login */ }
  }
  const r = await fetch(`${BRAIN_API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: BRAIN_PWD }),
  })
  const setCookie = r.headers.get('set-cookie')
  if (setCookie) {
    sessionCookie = setCookie.split(';')[0]
  }
  return sessionCookie
}

export async function proxyBrain(req: NextRequest, path: string) {
  return proxyBrainMethod(req, path, 'POST')
}

export async function proxyBrainGet(req: NextRequest, path: string) {
  return proxyBrainMethod(req, path, 'GET')
}

export async function proxyBrainMethod(
  req: NextRequest,
  path: string,
  method: string = 'POST',
) {
  try {
    const cookie = await ensureSession()
    const url = `${BRAIN_API}${path}`
    const headers: Record<string, string> = { Cookie: cookie }

    const opts: RequestInit = { method, headers }
    if (method !== 'GET' && method !== 'HEAD') {
      const body = await req.json().catch(() => ({}))
      headers['Content-Type'] = 'application/json'
      opts.body = JSON.stringify(body)
    }

    const res = await fetch(url, opts)
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

export async function proxyBrainDelete(req: NextRequest, path: string) {
  return proxyBrainMethod(req, path, 'DELETE')
}

export async function proxyBrainPatch(req: NextRequest, path: string) {
  return proxyBrainMethod(req, path, 'PATCH')
}
