import { NextRequest, NextResponse } from 'next/server'
import { commentPhoto } from '@/server/photo-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  const r = commentPhoto(b.id, b.author || 'fire', b.content || '')
  return NextResponse.json({ ok: r === 'ok', result: r })
}
