import { NextRequest, NextResponse } from 'next/server'
import { setPhotoPassword, verifyPhotoPassword, hasPhotoPassword } from '@/server/photo-store'

export async function POST(req: NextRequest) {
  const b = await req.json()
  if (b.action === 'set') {
    setPhotoPassword(b.password)
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'verify') {
    return NextResponse.json({ ok: verifyPhotoPassword(b.password) })
  }
  if (b.action === 'check') {
    return NextResponse.json({ hasPassword: hasPhotoPassword() })
  }
  return NextResponse.json({ error: 'invalid action' }, { status: 400 })
}
