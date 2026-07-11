import { NextRequest, NextResponse } from 'next/server'
import { deletePhoto } from '@/server/photo-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  const r = deletePhoto(b.id)
  return NextResponse.json({ ok: r === 'ok', result: r })
}
