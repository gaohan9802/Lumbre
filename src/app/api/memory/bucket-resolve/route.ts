import { NextRequest, NextResponse } from 'next/server'
import { toggleResolve } from '../../../../server/brain'
export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') || ''
  const result = toggleResolve(id)
  if (!result) return NextResponse.json({ error: 'not found' }, { status: 404 })
  return NextResponse.json(result)
}
