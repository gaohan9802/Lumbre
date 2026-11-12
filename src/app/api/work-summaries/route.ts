import { NextRequest, NextResponse } from 'next/server'
import { runWorkSummaryMaintenance, workSummarySnapshot } from '@/server/work-summary'

export const dynamic = 'force-dynamic'
export const maxDuration = 900

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('session_id') || ''
  if (!/^[A-Za-z0-9._:-]{1,180}$/.test(sessionId)) return NextResponse.json({ error: 'invalid_session_id' }, { status: 400 })
  return NextResponse.json(workSummarySnapshot(sessionId), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST() {
  return NextResponse.json(await runWorkSummaryMaintenance())
}
