import { NextRequest, NextResponse } from 'next/server'
import { lumbreTogetherDays, madridDateKey } from '@/lib/madrid-time'
import { readNosePokes, recordNosePoke } from '@/server/nose-pokes'

export const dynamic = 'force-dynamic'

function snapshot(sessionId: string) {
  const date = madridDateKey()
  const events = readNosePokes(date, sessionId)
  return { date, events, count: events.length, togetherDays: lumbreTogetherDays() }
}

function validSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(value)
}

export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId')
  if (!validSessionId(sessionId)) return NextResponse.json({ error: '缺少有效的聊天会话' }, { status: 400 })
  return NextResponse.json(snapshot(sessionId), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  if (!validSessionId(body.sessionId)) return NextResponse.json({ error: '缺少有效的聊天会话' }, { status: 400 })
  recordNosePoke(body.sessionId)
  return NextResponse.json({ ok: true, ...snapshot(body.sessionId) }, { headers: { 'Cache-Control': 'no-store' } })
}
