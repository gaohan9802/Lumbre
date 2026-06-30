import { NextRequest, NextResponse } from 'next/server'
import { writeNote } from '@/lib/diary-store'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const note = writeNote(body.author, body.content, body.tags)
    return NextResponse.json({ result: '📌 纸条已贴好！', note })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
