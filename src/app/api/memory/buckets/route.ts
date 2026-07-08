export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { buildIndex } from '../../../../server/brain'
export async function GET() {
  return NextResponse.json(buildIndex())
}
