import { NextRequest, NextResponse } from 'next/server'
import { getBucket } from '../../../../server/brain'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || ''
  const bucket = getBucket(id)
  if (!bucket) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(bucket)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const id = body.id || body.bucket_id || ''
  const bucket = getBucket(id)
  if (!bucket) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(bucket)
}
