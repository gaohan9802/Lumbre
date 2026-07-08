export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { pulse, buildIndex } from '../../../../server/brain'

export async function GET() {
  return NextResponse.json(pulse())
}

export async function POST() {
  // Legacy: return just the index array for tools compatibility
  return NextResponse.json(buildIndex())
}
