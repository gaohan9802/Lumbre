import { NextRequest, NextResponse } from 'next/server'
import { unlockDiary, hasPassword } from '@/lib/diary-store'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!hasPassword(body.target_author)) {
      return NextResponse.json({ error: '对方还没设置密码' }, { status: 403 })
    }
    const result = unlockDiary(body.target_author, body.password, body.target_date, body.time_id)
    if (result.error) return NextResponse.json(result, { status: 403 })
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
