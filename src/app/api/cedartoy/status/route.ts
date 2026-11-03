import { NextResponse } from 'next/server'
import { cedarToyConfigured } from '@/server/cedartoy'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ configured: cedarToyConfigured() })
}
