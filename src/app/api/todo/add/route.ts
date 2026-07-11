import { NextRequest, NextResponse } from 'next/server'
import { addTodo } from '@/server/todo-store'
export async function POST(req: NextRequest) {
  const b = await req.json()
  if (!b.text?.trim()) return NextResponse.json({ error: 'text required' }, { status: 400 })
  const item = addTodo(b.text.trim(), b.author || 'fire', b.date)
  return NextResponse.json({ ok: true, item })
}
