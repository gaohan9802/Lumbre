import { NextResponse } from 'next/server'
import { readCcStatus } from '@/server/chat/cc-gateway'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const conversationId = new URL(request.url).searchParams.get('conversation_id') || undefined
  return NextResponse.json(await readCcStatus(conversationId), { headers: { 'cache-control': 'no-store' } })
}
