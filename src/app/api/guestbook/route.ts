import { NextRequest, NextResponse } from 'next/server'
import { deleteGuestbookMessage, readGuestbook, writeGuestbookMessage } from '@/server/guestbook-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(readGuestbook(), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (body.action === 'delete') {
      const result = deleteGuestbookMessage('fire', body.message_id, body.reply_id)
      if (result === 'not_found') return NextResponse.json({ error: '找不到这条留言' }, { status: 404 })
      if (result === 'forbidden') return NextResponse.json({ error: '不能删除别人的留言' }, { status: 403 })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ ok: true, message: writeGuestbookMessage('fire', body.content, body.reply_to, body.reply_to_reply) })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '留言失败' }, { status: 400 })
  }
}
