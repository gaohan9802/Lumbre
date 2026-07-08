export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { archiveBucket } from '../../../../server/brain'
export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || ''
  const ok = archiveBucket(id)
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
