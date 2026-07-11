import { NextRequest, NextResponse } from 'next/server'
import { toggleTodo } from '@/server/todo-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  const r = toggleTodo(b.id, b.date)
  return NextResponse.json({ ok: r === 'ok', result: r })
}
