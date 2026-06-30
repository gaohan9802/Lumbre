import { NextRequest, NextResponse } from 'next/server'
import { updateDiary } from '@/lib/diary-store'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = updateDiary(body.target_date, body.author, body.new_content, body.time_id)
    if (result === 'not_found') return NextResponse.json({ error: '找不到日记' }, { status: 404 })
    return NextResponse.json({ result: '✅ 已追加内容' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
