import { NextRequest, NextResponse } from 'next/server'
import { replyNote } from '@/lib/diary-store'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = replyNote(body.note_id, body.author, body.content)
    if (result === 'not_found') return NextResponse.json({ error: '找不到纸条' }, { status: 404 })
    return NextResponse.json({ result: '↪️ 回复成功' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
