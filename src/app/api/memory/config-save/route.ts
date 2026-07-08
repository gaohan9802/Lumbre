export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { saveConfig, getConfig } from '../../../../server/brain'
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const current = getConfig()
  const merged = { ...current, ...body }
  saveConfig(merged)
  return NextResponse.json({ ok: true, config: merged })
}
