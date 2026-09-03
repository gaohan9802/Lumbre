import { NextRequest, NextResponse } from 'next/server'
import { resolveAndExecuteToolConfirmation } from '@/server/agent/executor'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (typeof body?.token !== 'string' || body.token.length < 20) {
      return NextResponse.json({ ok: false, error: 'Invalid confirmation token' }, { status: 400 })
    }
    const result = await resolveAndExecuteToolConfirmation({
      token: body.token,
      actorId: 'lumbre-authenticated-user',
      sessionId: typeof body.session_id === 'string' ? body.session_id : undefined,
      approve: body.approve === true,
    })
    return NextResponse.json(result, { status: result.ok ? 200 : 409, headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Confirmation failed' }, { status: 500 })
  }
}
