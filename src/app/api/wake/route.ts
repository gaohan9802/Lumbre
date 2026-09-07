import { NextRequest, NextResponse } from 'next/server'
import {
  loadWakeLogs, updateWakeSettings,
  startWakeEngine, reportActivity,
  nextWakeSchedule, refreshWakeSchedule, scheduleWake,
} from '@/server/autowake'

export const dynamic = 'force-dynamic'

export async function GET() {
  const config = refreshWakeSchedule()
  const logs = loadWakeLogs().slice(-50).reverse()
  const next = nextWakeSchedule(config)
  return NextResponse.json({ config, logs, next })
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  if (body.action === 'activity') {
    reportActivity()
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'schedule' && typeof body.at === 'number') {
    const alarm = scheduleWake(body.at, body.note)
    return NextResponse.json({ ok: true, alarm })
  }

  updateWakeSettings({
    ...(body.enabled !== undefined ? { enabled: !!body.enabled } : {}),
    ...(body.sessionId !== undefined ? { sessionId: body.sessionId || null } : {}),
    ...(body.customPrompt !== undefined ? { customPrompt: body.customPrompt } : {}),
    ...(body.pushEnabled !== undefined ? { pushEnabled: !!body.pushEnabled } : {}),
    ...(body.day && typeof body.day === 'object' ? { day: body.day } : {}),
    ...(body.night && typeof body.night === 'object' ? { night: body.night } : {}),
    ...(body.random && typeof body.random === 'object' ? { random: body.random } : {}),
    ...(body.inactivity && typeof body.inactivity === 'object' ? { inactivity: body.inactivity } : {}),
    ...(body.warmCache && typeof body.warmCache === 'object' ? { warmCache: body.warmCache } : {}),
  })

  startWakeEngine()

  const current = refreshWakeSchedule()
  return NextResponse.json({ ok: true, config: current, next: nextWakeSchedule(current) })
}
