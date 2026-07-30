export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getCoreadStats } from '@/server/coread-store'
export async function GET(req: NextRequest) {
  try { return NextResponse.json({ stats: getCoreadStats(req.nextUrl.searchParams.get('bookId') || undefined) }) }
  catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
