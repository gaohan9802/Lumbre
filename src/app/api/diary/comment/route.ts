import { NextRequest, NextResponse } from 'next/server'
import { commentDiary } from '@/lib/diary-store'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const result = commentDiary(body.target_date, body.target_author, body.commenter, body.content, body.time_id)
    if (result === 'not_found') return NextResponse.json({ error: '找不到日记' }, { status: 404 })
    if (result === 'locked') return NextResponse.json({ error: '日记已上锁' }, { status: 403 })
    return NextResponse.json({ result: '💬 评论成功！' })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
