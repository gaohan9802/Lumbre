import { NextRequest, NextResponse } from 'next/server'
import {
  loadWakeConfig, loadWakeLogs, updateWakeSettings,
  startWakeEngine, stopWakeEngine, reportActivity,
  nextWakeInfo, scheduleWake,
} from '@/server/autowake'

export const dynamic = 'force-dynamic'

export async function GET() {
  const config = loadWakeConfig()
  const logs = loadWakeLogs().slice(-50).reverse()
  const next = config.enabled && config.sessionId ? nextWakeInfo(config) : null
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

  const config = updateWakeSettings({
    ...(body.enabled !== undefined ? { enabled: !!body.enabled } : {}),
    ...(body.sessionId !== undefined ? { sessionId: body.sessionId || null } : {}),
    ...(body.customPrompt !== undefined ? { customPrompt: body.customPrompt } : {}),
    ...(body.pushEnabled !== undefined ? { pushEnabled: !!body.pushEnabled } : {}),
  })

  if (config.enabled) {
    startWakeEngine()
  } else {
    stopWakeEngine()
  }

  return NextResponse.json({ ok: true, config })
}
