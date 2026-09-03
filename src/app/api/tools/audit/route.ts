import { NextRequest, NextResponse } from 'next/server'
import { readToolAudit } from '@/server/data/log'

export async function GET(request: NextRequest) {
  const requested = Number(request.nextUrl.searchParams.get('limit') || 100)
  const limit = Number.isFinite(requested) ? requested : 100
  return NextResponse.json(
    { events: readToolAudit(limit) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
