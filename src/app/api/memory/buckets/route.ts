export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { buildIndex, getIndexPage } from '../../../../server/brain'
export async function GET(req: NextRequest) {
  // Legacy callers without paging params still receive the old array shape.
  const paged = req.nextUrl.searchParams.has('limit') || req.nextUrl.searchParams.has('cursor') || req.nextUrl.searchParams.has('filter')
  if (!paged) return NextResponse.json(buildIndex())
  return NextResponse.json(getIndexPage({
    cursor: Number(req.nextUrl.searchParams.get('cursor') || 0),
    limit: Number(req.nextUrl.searchParams.get('limit') || 100),
    filter: req.nextUrl.searchParams.get('filter') || 'all',
  }))
}
