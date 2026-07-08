export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { editBucket } from '../../../../server/brain'
export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || ''
  const body = await req.json().catch(() => ({}))
  const result = editBucket(id, body)
  if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(result)
}
