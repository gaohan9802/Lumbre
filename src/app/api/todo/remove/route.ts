import { NextRequest, NextResponse } from 'next/server'
import { removeTodo } from '@/server/todo-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  const r = removeTodo(b.id, b.date)
  return NextResponse.json({ ok: r === 'ok', result: r })
}
