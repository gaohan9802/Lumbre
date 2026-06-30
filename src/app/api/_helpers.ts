/**
 * Server-side proxy helper.
 * Routes diary/notes through starfire-diary backend,
 * and memory through ombre brain backend.
 * The env vars hold the base URLs; no auth token needed for now
 * (both backends are open or session-based).
 */
import { NextRequest, NextResponse } from 'next/server'

const DIARY_API = process.env.DIARY_API_BASE || 'https://starfire-diary.zeabur.app'
const BRAIN_API = process.env.BRAIN_API_BASE || 'https://xiaohuo.zeabur.app'

export async function proxyDiary(req: NextRequest, path: string) {
  return doProxy(req, DIARY_API, path)
}

export async function proxyBrain(req: NextRequest, path: string) {
  return doProxy(req, BRAIN_API, path)
}

async function doProxy(req: NextRequest, base: string, path: string) {
  try {
    const body = await req.json().catch(() => ({}))
    const url = `${base}${path}`
    const res = await fetch(url, {
      method: 'POST',
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
