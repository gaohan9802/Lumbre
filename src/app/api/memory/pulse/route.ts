import { NextResponse } from 'next/server'
import { buildIndex } from '../../../../server/brain'
export async function POST() {
  return NextResponse.json(buildIndex())
}
export async function GET() {
  return NextResponse.json(buildIndex())
}
