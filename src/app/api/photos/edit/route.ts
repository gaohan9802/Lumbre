import { NextRequest, NextResponse } from 'next/server'
import { editPhoto } from '@/server/photo-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  const r = editPhoto(b.id, { caption: b.caption })
  return NextResponse.json({ ok: r === 'ok', result: r })
}
