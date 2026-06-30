import { NextRequest, NextResponse } from 'next/server'
import { listNotes } from '@/lib/diary-store'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const notes = listNotes({ keyword: body.keyword, limit: body.limit })
    return NextResponse.json({ notes })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
