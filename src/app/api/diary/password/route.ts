import { NextRequest, NextResponse } from 'next/server'
import { setPassword } from '@/lib/diary-store'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    setPassword(body.author, body.password)
    return NextResponse.json({ result: `🔐 密码已设置` })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
