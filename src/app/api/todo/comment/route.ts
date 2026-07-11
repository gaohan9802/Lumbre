import { NextRequest, NextResponse } from 'next/server'
import { commentTodo } from '@/server/todo-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  const r = commentTodo(b.id, b.author || 'fire', b.content || '', b.date)
  return NextResponse.json({ ok: r === 'ok', result: r })
}
