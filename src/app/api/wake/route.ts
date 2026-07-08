import { NextRequest, NextResponse } from 'next/server'
import {
  loadWakeConfig, saveWakeConfig, loadWakeLogs,
  startWakeEngine, stopWakeEngine, reportActivity,
} from '@/server/autowake'

export async function GET() {
  const config = loadWakeConfig()
  const logs = loadWakeLogs().slice(-50).reverse()
  return NextResponse.json({ config, logs })
}

export async function POST(req: NextRequest) {
  const body = await req.json()

  if (body.action === 'activity') {
    reportActivity()
    return NextResponse.json({ ok: true })
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
