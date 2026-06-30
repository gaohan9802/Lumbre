// Server-side helper: proxy a request to Ombre Brain / starfire-diary backend.
// All Lumbre /api/* routes are thin pass-throughs so that the backend URL/token
// never reaches the client.

import { NextRequest, NextResponse } from 'next/server'

const BRAIN_API = process.env.BRAIN_API_BASE || ''
const BRAIN_TOKEN = process.env.BRAIN_API_TOKEN || ''

export async function proxy(req: NextRequest, path: string) {
  try {
    const body = await req.json().catch(() => ({}))
    const res = await fetch(`${BRAIN_API}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BRAIN_TOKEN}`,
      },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    // forward as JSON if possible, else as text
    try {
      return NextResponse.json(JSON.parse(text), { status: res.status })
    } catch {
      return new NextResponse(text, { status: res.status })
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
