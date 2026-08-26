import { NextRequest, NextResponse } from 'next/server'
import { deleteActivity, getCurrentActivity, getTimelineTags, listActivities, startActivity, stopActivity, timelineDurationSeconds, updateActivity, setTimelineTags } from '@/server/timeline-store'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const records = listActivities(q.get('from') || undefined, q.get('to') || undefined)
  return NextResponse.json({
    current: getCurrentActivity(),
    tags: getTimelineTags(),
    records: records.map(r => ({ ...r, duration_seconds: timelineDurationSeconds(r) })),
    now: new Date().toISOString(),
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (body.action === 'tags') return NextResponse.json({ ok: true, tags: setTimelineTags(body.tags) })
    if (body.action === 'start') return NextResponse.json({ ok: true, record: startActivity(body.title, body.tags, body.note, body.start_at) })
    if (body.action === 'stop') return NextResponse.json({ ok: true, record: stopActivity(body.id, body.end_note, body.end_at) })
    if (body.action === 'update') return NextResponse.json({ ok: true, record: updateActivity(body.id, body.patch || {}) })
    if (body.action === 'delete') return NextResponse.json({ ok: deleteActivity(body.id) })
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'timeline_error' }, { status: 400 })
  }
}
