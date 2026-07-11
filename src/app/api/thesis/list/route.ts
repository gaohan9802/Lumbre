import { NextResponse } from 'next/server'
import { getThesis } from '@/server/thesis-store'
export const dynamic = 'force-dynamic'
export async function GET() {
  return NextResponse.json(getThesis())
}
