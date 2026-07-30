import { NextRequest, NextResponse } from 'next/server'
import { editTodo } from '@/server/todo-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  const r = editTodo(b.id, b.text, b.date)
  return NextResponse.json({ ok: r === 'ok', result: r })
}
