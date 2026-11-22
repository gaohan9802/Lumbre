import { NextRequest, NextResponse } from 'next/server'
import { isTrustedNurseryEventRequest } from '@/server/nursery-auth'
import { saveNurseryEvent } from '@/server/nursery-events'
import { incrementRoomUnread } from '@/server/room-unread-store'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isTrustedNurseryEventRequest(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    const body = await request.json()
    if (!body || typeof body !== 'object' || JSON.stringify(body).length > 32_000) {
      return NextResponse.json({ error: 'Invalid event' }, { status: 400 })
    }
    const added = saveNurseryEvent(body)
    if (added) incrementRoomUnread('nursery')
    return NextResponse.json({ ok: true, added }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid event' }, { status: 400 })
  }
}
