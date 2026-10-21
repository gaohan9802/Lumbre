import { NextRequest, NextResponse } from 'next/server'
import { compactCcSession } from '@/server/chat/cc-gateway'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const result = await compactCcSession(String(body?.session_id || ''))
    return NextResponse.json(result, { status: result.status === 'compacted' ? 200 : result.status === 'busy' ? 409 : 502 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '压缩 CC 上下文失败' }, { status: 400 })
  }
}
