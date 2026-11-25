import { NextRequest, NextResponse } from 'next/server'
import { normalizeChatWindowRole } from '@/lib/chat-window-role'
import { compactCcSession } from '@/server/chat/cc-gateway'
import { loadSyncSessionTails } from '@/server/chat-sync'
import { checkpointChatSummary } from '@/server/summary-archive'

export const runtime = 'nodejs'
export const maxDuration = 900

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const sessionId = String(body?.session_id || '')
    if (!/^[A-Za-z0-9._:-]{1,180}$/.test(sessionId)) return NextResponse.json({ error: 'invalid_session_id' }, { status: 400 })
    const session = loadSyncSessionTails([sessionId], 1)[0]
    if (!session || normalizeChatWindowRole(session.windowRole) !== 'chat') return NextResponse.json({ error: 'not_chat_window' }, { status: 400 })
    const checkpoint = session.ccModel === 'claude-opus-4-6' ? await checkpointChatSummary(sessionId) : null
    const result = await compactCcSession(sessionId)
    return NextResponse.json({ checkpoint, ...result }, { status: result.status === 'compacted' ? 200 : result.status === 'busy' ? 409 : 502 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '压缩 CC 上下文失败' }, { status: 400 })
  }
}
