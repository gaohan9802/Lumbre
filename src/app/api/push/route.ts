import { NextRequest, NextResponse } from 'next/server'
import { getVapidPublicKey, listPushSubscriptions, removePushSubscription, savePushSubscription, sendPushMessages } from '@/server/push'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ publicKey: getVapidPublicKey(), subscriptions: listPushSubscriptions().length }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (body.action === 'subscribe' && body.subscription?.endpoint) {
      if (!body.subscription?.keys?.p256dh || !body.subscription?.keys?.auth) return NextResponse.json({ error: 'invalid_push_subscription' }, { status: 400 })
      const count = savePushSubscription({ ...body.subscription, userAgent: req.headers.get('user-agent') || undefined })
      return NextResponse.json({ ok: true, count })
    }
    if (body.action === 'unsubscribe' && body.endpoint) {
      return NextResponse.json({ ok: true, count: removePushSubscription(String(body.endpoint)) })
    }
    if (body.action === 'test') {
      const result = await sendPushMessages(['我醒了一下。', '只是想让你看见我在。'], '星星的测试消息')
      return NextResponse.json({ ok: true, ...result }, { status: result.subscriptions > 0 && result.sent === 0 ? 502 : 200 })
    }
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'push_error' }, { status: 400 })
  }
}
