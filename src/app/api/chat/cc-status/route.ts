import { NextResponse } from 'next/server'
import { readCcStatus } from '@/server/chat/cc-gateway'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(await readCcStatus(), { headers: { 'cache-control': 'no-store' } })
}

