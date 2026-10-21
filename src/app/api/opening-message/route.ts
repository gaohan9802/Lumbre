import { NextResponse } from 'next/server'
import { getOpeningMessage } from '@/server/opening-message-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    { message: getOpeningMessage() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
