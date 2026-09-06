import { NextRequest, NextResponse } from 'next/server'
import { cancelCcAttempt } from '@/server/chat/cc-gateway'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  try {
    const result = await cancelCcAttempt(await request.json())
    return NextResponse.json(result, { status: result.ok ? 202 : result.status })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '取消 CC 任务失败' }, { status: 400 })
  }
}
