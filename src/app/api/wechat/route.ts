import { NextRequest, NextResponse } from 'next/server'
import { loadSyncManifest } from '@/server/chat-sync'
import { pollWeChatQrLogin, startWeChatQrLogin } from '@/server/wechat/client'
import { getWeChatMonitorStatus, restartWeChatMonitor, stopWeChatMonitor } from '@/server/wechat/monitor'
import {
  clearWeChatConnection,
  patchWeChatConnection,
  readWeChatConnection,
  writeWeChatConnection,
} from '@/server/wechat/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sessionExists(sessionId: string) {
  return loadSyncManifest().sessions.some(session => session.id === sessionId)
}

function statusPayload() {
  const connection = readWeChatConnection()
  return {
    connected: !!connection,
    targetSessionId: connection?.targetSessionId,
    connectedAt: connection?.connectedAt,
    lastMessageAt: connection?.lastMessageAt,
    lastError: connection?.lastError,
    monitor: getWeChatMonitorStatus(),
  }
}

function errorResponse(cause: unknown, status = 400) {
  return NextResponse.json({ error: cause instanceof Error ? cause.message : String(cause) }, { status })
}

export async function GET() {
  return NextResponse.json(statusPayload(), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  let body: any
  try { body = await request.json() } catch { return errorResponse('请求格式不正确') }
  try {
    if (body?.action === 'start_login') {
      const targetSessionId = String(body.targetSessionId || '')
      if (!sessionExists(targetSessionId)) return errorResponse('要绑定的聊天窗口不存在', 404)
      const login = await startWeChatQrLogin()
      return NextResponse.json({ ...login, targetSessionId })
    }
    if (body?.action === 'poll_login') {
      const qrcodeId = String(body.qrcodeId || '')
      const targetSessionId = String(body.targetSessionId || '')
      if (!qrcodeId) return errorResponse('缺少二维码编号')
      if (!sessionExists(targetSessionId)) return errorResponse('要绑定的聊天窗口不存在', 404)
      const result = await pollWeChatQrLogin(qrcodeId, body.pollBaseUrl, body.verifyCode)
      if (result.status !== 'confirmed' || !result.account) return NextResponse.json(result)
      writeWeChatConnection({
        ...result.account,
        targetSessionId,
        connectedAt: new Date().toISOString(),
      })
      restartWeChatMonitor()
      return NextResponse.json({ status: 'confirmed', ...statusPayload() })
    }
    if (body?.action === 'bind_session') {
      const targetSessionId = String(body.targetSessionId || '')
      if (!sessionExists(targetSessionId)) return errorResponse('要绑定的聊天窗口不存在', 404)
      if (!patchWeChatConnection({ targetSessionId, lastError: undefined })) return errorResponse('微信还没有连接', 409)
      restartWeChatMonitor()
      return NextResponse.json(statusPayload())
    }
    if (body?.action === 'disconnect') {
      stopWeChatMonitor()
      clearWeChatConnection()
      return NextResponse.json(statusPayload())
    }
    return errorResponse('未知的微信操作')
  } catch (cause) {
    return errorResponse(cause, 500)
  }
}
