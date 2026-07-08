export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { purgeBuckets } from '../../../../server/brain'
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({ ids: [] }))
  const ids = body.ids || body.bucket_ids || []
  const result = purgeBuckets(ids)
  return NextResponse.json(result)
}
