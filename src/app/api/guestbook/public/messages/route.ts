import { NextRequest, NextResponse } from 'next/server'
import { guestbookCookie, verifyGuestbookSession } from '@/server/guestbook-auth'
import { deleteGuestbookMessage, readGuestbook, writeGuestbookMessage } from '@/server/guestbook-store'

export const dynamic = 'force-dynamic'

async function authorized(request: NextRequest): Promise<boolean> {
  return verifyGuestbookSession(request.cookies.get(guestbookCookie.name)?.value)
}

export async function GET(request: NextRequest) {
  if (!await authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(readGuestbook(), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  if (!await authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json()
    if (body.action === 'delete') {
      const result = deleteGuestbookMessage('guest', body.message_id, body.reply_id)
      if (result === 'not_found') return NextResponse.json({ error: '找不到这条留言' }, { status: 404 })
      if (result === 'forbidden') return NextResponse.json({ error: '只能删除自己的留言' }, { status: 403 })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ ok: true, message: writeGuestbookMessage('guest', body.content, body.reply_to) })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '留言失败' }, { status: 400 })
  }
}
