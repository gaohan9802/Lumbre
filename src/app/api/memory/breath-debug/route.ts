export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { breathDebug } from '../../../../server/brain'
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || ''
  const v = req.nextUrl.searchParams.get('valence')
  const a = req.nextUrl.searchParams.get('arousal')
  const results = breathDebug(
    q,
    v ? parseFloat(v) : undefined,
    a ? parseFloat(a) : undefined,
  )
  return NextResponse.json(results)
}
