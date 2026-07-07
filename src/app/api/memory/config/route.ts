import { NextResponse } from 'next/server'
import { getConfig } from '../../../../server/brain'
export async function GET() {
  return NextResponse.json(getConfig())
}
