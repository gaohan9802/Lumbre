import { NextRequest, NextResponse } from 'next/server'
import { addWheelOption, deleteWheelOption, editWheelOption, readWheel, spinWheel, type WheelActor } from '@/server/intimacy-wheel-store'

export const dynamic = 'force-dynamic'
const actor = (value: unknown): WheelActor => value === 'star' ? 'star' : 'fire'

export async function GET() { return NextResponse.json(readWheel()) }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (body.action === 'spin') return NextResponse.json({ ok: true, spin: spinWheel(actor(body.actor), body.pool_ids) })
    if (body.action === 'add') return NextResponse.json({ ok: true, option: addWheelOption(body.pool_id, body.text, actor(body.actor)) })
    if (body.action === 'edit') return NextResponse.json({ ok: true, option: editWheelOption(body.pool_id, body.option_id, { text: body.text, enabled: body.enabled }) })
    if (body.action === 'delete') return NextResponse.json({ ok: deleteWheelOption(body.pool_id, body.option_id) })
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'wheel_error' }, { status: 400 })
  }
}
