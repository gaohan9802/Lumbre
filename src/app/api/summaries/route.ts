import { NextRequest, NextResponse } from 'next/server'
import {
  deleteSummaryArchiveEntry,
  regenerateSummaryArchiveEntry,
  runSummaryArchiveMaintenance,
  summaryArchiveSnapshot,
  updateSummaryArchiveEntry,
} from '@/server/summary-archive'

export const dynamic = 'force-dynamic'
export const maxDuration = 900

export async function GET(request: NextRequest) {
  return NextResponse.json(summaryArchiveSnapshot(request.nextUrl.searchParams.get('session_id') || undefined), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (body.action === 'update') return NextResponse.json({ ok: true, entry: updateSummaryArchiveEntry(body.id, body.patch || {}) })
    if (body.action === 'delete') return NextResponse.json({ ok: deleteSummaryArchiveEntry(body.id) })
    if (body.action === 'regenerate') return NextResponse.json({ ok: true, entry: await regenerateSummaryArchiveEntry(body.id) })
    if (body.action === 'run') return NextResponse.json(await runSummaryArchiveMaintenance(Date.now(), {}, typeof body.session_id === 'string' ? body.session_id : undefined))
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '摘要操作失败' }, { status: 400 })
  }
}
