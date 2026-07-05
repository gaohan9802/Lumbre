import { NextRequest, NextResponse } from 'next/server'

const BRAIN_API = process.env.BRAIN_API_BASE || 'https://xiaohuo.zeabur.app'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const familyId = body.family_id || ''
    const action = body.action || 'detail' // detail | expand
    
    const path = action === 'expand' 
      ? `/api/family/${familyId}/expand`
      : `/api/family/${familyId}`
    
    const res = await fetch(`${BRAIN_API}${path}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
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
