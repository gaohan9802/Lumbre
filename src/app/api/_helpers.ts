/**
 * Server-side proxy helper.
 * Routes diary/notes through starfire-diary backend,
 * and memory through ombre brain backend.
 */
import { NextRequest, NextResponse } from 'next/server'

const DIARY_API = process.env.DIARY_API_BASE || 'https://starfire-diary.zeabur.app'
const BRAIN_API = process.env.BRAIN_API_BASE || 'https://xiaohuo.zeabur.app'

export async function proxyDiary(req: NextRequest, path: string) {
  return doProxy(req, DIARY_API, path, 'POST')
}

export async function proxyDiaryGet(req: NextRequest, path: string) {
  return doProxyGet(req, DIARY_API, path)
}

export async function proxyBrain(req: NextRequest, path: string) {
  return doProxy(req, BRAIN_API, path, 'POST')
}

/** POST proxy — sends body as JSON */
async function doProxy(req: NextRequest, base: string, path: string, method: string) {
  try {
    const body = await req.json().catch(() => ({}))
    const url = `${base}${path}`
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
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

/** GET proxy — sends body fields as query params */
async function doProxyGet(req: NextRequest, base: string, path: string) {
  try {
    const body = await req.json().catch(() => ({}))
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
    }
    const qs = params.toString()
    const url = `${base}${path}${qs ? '?' + qs : ''}`
    const res = await fetch(url, { method: 'GET' })
    const text = await res.text()
    try {
      // Backend returns array directly for diary/list and notes/list
      const parsed = JSON.parse(text)
      // Normalize: if it's an array, wrap it
      if (Array.isArray(parsed)) {
        return NextResponse.json({ entries: parsed }, { status: res.status })
      }
      return NextResponse.json(parsed, { status: res.status })
    } catch {
      return new NextResponse(text, { status: res.status })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
