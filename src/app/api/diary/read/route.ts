import { NextRequest, NextResponse } from 'next/server'
import { readDiaries } from '@/lib/diary-store'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const entries = readDiaries(body.viewer || 'fire', {
      keyword: body.keyword,
      author_filter: body.author_filter,
      target_date: body.target_date,
    })
    return NextResponse.json({ entries })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
