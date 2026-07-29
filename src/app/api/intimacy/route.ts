import { NextRequest, NextResponse } from 'next/server'
import { createIntimacyRecord, deleteIntimacyRecord, intimacyOptions, listIntimacyActivity, listIntimacyRecords, updateIntimacyRecord } from '@/server/intimacy-store'
export const dynamic = 'force-dynamic'
export async function GET() { return NextResponse.json({ records: listIntimacyRecords(), activity: listIntimacyActivity(), options: intimacyOptions() }) }
export async function POST(req: NextRequest) {
  try {
    const b = await req.json(); const who = b.actor === 'star' ? 'star' : 'fire'
    if (b.action === 'create') return NextResponse.json({ ok: true, record: createIntimacyRecord(b.record || {}, who) })
    if (b.action === 'update') { const record = updateIntimacyRecord(b.id, b.patch || {}, who); return record ? NextResponse.json({ ok: true, record }) : NextResponse.json({ error: 'not found' }, { status: 404 }) }
    if (b.action === 'delete') return NextResponse.json({ ok: deleteIntimacyRecord(b.id, who) })
    return NextResponse.json({ error: 'invalid action' }, { status: 400 })
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }) }
}
