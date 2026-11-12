import { NextRequest, NextResponse } from 'next/server'
import { isCcModel } from '@/lib/cc-model'
import { normalizeChatWindowRole } from '@/lib/chat-window-role'
import { compactCcSession, warmCcSession } from '@/server/chat/cc-gateway'
import { loadSyncSessionTails } from '@/server/chat-sync'
import { checkpointWorkSummary } from '@/server/work-summary'

export const runtime = 'nodejs'
export const maxDuration = 900

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const sessionId = String(body?.session_id || '')
    if (!/^[A-Za-z0-9._:-]{1,180}$/.test(sessionId)) return NextResponse.json({ error: 'invalid_session_id' }, { status: 400 })
    const session = loadSyncSessionTails([sessionId], 20)[0]
    if (!session || normalizeChatWindowRole(session.windowRole) !== 'work') return NextResponse.json({ error: 'not_work_window' }, { status: 400 })
    const checkpoint = await checkpointWorkSummary(sessionId)
    const compacted: any = await compactCcSession(sessionId)
    if (compacted?.status !== 'compacted') return NextResponse.json({ checkpoint, ...compacted }, { status: compacted?.status === 'busy' ? 409 : 502 })
    const model = isCcModel(session.ccModel) ? session.ccModel : undefined
    const warmed = await warmCcSession(sessionId, model)
    return NextResponse.json({ checkpoint, ...compacted, warmed: warmed?.status === 'warmed' })
  } catch (cause) {
    return NextResponse.json({ error: cause instanceof Error ? cause.message : '工作窗维护失败' }, { status: 500 })
  }
}
