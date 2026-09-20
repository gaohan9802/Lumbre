import { NextResponse } from 'next/server'
import { lumbreTogetherDays, madridDateKey } from '@/lib/madrid-time'
import { readNosePokes, recordNosePoke } from '@/server/nose-pokes'

export const dynamic = 'force-dynamic'

function snapshot() {
  const date = madridDateKey()
  const events = readNosePokes(date)
  return { date, events, count: events.length, togetherDays: lumbreTogetherDays() }
}

export async function GET() {
  return NextResponse.json(snapshot(), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST() {
  recordNosePoke()
  return NextResponse.json({ ok: true, ...snapshot() }, { headers: { 'Cache-Control': 'no-store' } })
}
