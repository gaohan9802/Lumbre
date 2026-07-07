import { NextResponse } from 'next/server'
import { getNetwork } from '../../../../server/brain'
export async function GET() {
  return NextResponse.json(getNetwork())
}
