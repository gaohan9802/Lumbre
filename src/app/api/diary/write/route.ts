import { NextRequest, NextResponse } from 'next/server'
import { writeDiary } from '@/lib/diary-store'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const entry = writeDiary(body)
    return NextResponse.json({ result: 'ok', entry })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
