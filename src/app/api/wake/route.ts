import { NextRequest, NextResponse } from 'next/server'
import {
  loadWakeConfig, saveWakeConfig, loadWakeLogs,
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

  const config = loadWakeConfig()

  if (body.enabled !== undefined) config.enabled = !!body.enabled
  if (body.sessionId !== undefined) config.sessionId = body.sessionId
  if (body.customPrompt !== undefined) config.customPrompt = body.customPrompt

  saveWakeConfig(config)

  if (config.enabled) {
    startWakeEngine()
  } else {
    stopWakeEngine()
  }

  return NextResponse.json({ ok: true, config })
}
