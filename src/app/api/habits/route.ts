import { NextRequest, NextResponse } from 'next/server'
import { archiveHabit, createHabit, listHabits, renameHabit, toggleHabit } from '@/server/habit-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json({ habits: listHabits() })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (body.action === 'create') return NextResponse.json({ habit: createHabit(body.name) })
    if (body.action === 'rename') return NextResponse.json({ habit: renameHabit(body.id, body.name) })
    if (body.action === 'archive') return NextResponse.json({ habit: archiveHabit(body.id) })
    if (body.action === 'toggle') return NextResponse.json({ habit: toggleHabit(body.id, body.date) })
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'habit_error' }, { status: 400 })
  }
}
