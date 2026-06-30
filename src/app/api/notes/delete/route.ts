import { NextRequest, NextResponse } from 'next/server'
import { deleteNote } from '@/lib/diary-store'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = deleteNote(body.note_id, body.author)
    if (result === 'not_found') return NextResponse.json({ error: '找不到纸条' }, { status: 404 })
    if (result === 'forbidden') return NextResponse.json({ error: '只能删自己的纸条' }, { status: 403 })
    return NextResponse.json({ result: '🗑️ 纸条已撕掉' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
