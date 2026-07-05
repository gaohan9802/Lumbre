/**
 * Server-side proxy helper.
 * Only used for Ombre Brain (memory) now.
 */
import { NextRequest, NextResponse } from 'next/server'

const BRAIN_API = process.env.BRAIN_API_BASE || 'https://xiaohuo.zeabur.app'
const BRAIN_TOKEN = process.env.BRAIN_API_TOKEN || ''

function brainHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (BRAIN_TOKEN) h['X-Admin-Token'] = BRAIN_TOKEN
  return h
}

export async function proxyBrain(req: NextRequest, path: string) {
  try {
    const body = await req.json().catch(() => ({}))
    const url = `${BRAIN_API}${path}`
    const res = await fetch(url, {
      method: 'POST',
      headers: brainHeaders(),
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

export async function proxyBrainGet(path: string, params?: Record<string, string>) {
  try {
    const url = new URL(`${BRAIN_API}${path}`)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v) url.searchParams.set(k, v)
      }
    }
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: brainHeaders(),
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
