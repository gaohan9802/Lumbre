import { NextResponse } from 'next/server'
import { readFutureLetter } from '@/server/future-letter-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(
    { letter: readFutureLetter() },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
