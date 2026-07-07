import { NextResponse } from 'next/server'
import { getStatus } from '../../../../server/brain'
export async function GET() {
  return NextResponse.json(getStatus())
}
