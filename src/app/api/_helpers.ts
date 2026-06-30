/**
 * Server-side proxy helper.
 * Only used for Ombre Brain (memory) now.
 * Diary/notes are handled locally by diary-store.
 */
import { NextRequest, NextResponse } from 'next/server'

const BRAIN_API = process.env.BRAIN_API_BASE || 'https://xiaohuo.zeabur.app'

export async function proxyBrain(req: NextRequest, path: string) {
  try {
    const body = await req.json().catch(() => ({}))
    const url = `${BRAIN_API}${path}`
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
