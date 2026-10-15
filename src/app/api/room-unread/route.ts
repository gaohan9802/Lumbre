import { NextRequest, NextResponse } from 'next/server'
import { guestbookUnreadCount } from '@/server/guestbook-store'
import { isRoomUnreadKey, markRoomRead, readRoomUnreadCounts } from '@/server/room-unread-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  const unread = readRoomUnreadCounts()
  unread.notes += guestbookUnreadCount('fire')
  return NextResponse.json({ unread }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!isRoomUnreadKey(body.room)) return NextResponse.json({ error: '未知房间' }, { status: 400 })
    markRoomRead(body.room)
    return NextResponse.json({ ok: true, room: body.room, unread: 0 })
  } catch {
    return NextResponse.json({ error: '无法更新房间已读状态' }, { status: 400 })
  }
}
