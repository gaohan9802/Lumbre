import { NextRequest, NextResponse } from 'next/server'
import { getPeriodState, recordPeriodStart, recordPeriodEnd, updatePeriodConfig } from '@/server/period-store'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(getPeriodState())
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, date, cycle_days, period_length } = body
    if (action === 'start' && date) return NextResponse.json(recordPeriodStart(date))
    if (action === 'end' && date) return NextResponse.json(recordPeriodEnd(date))
    if (action === 'config') return NextResponse.json(updatePeriodConfig(cycle_days, period_length))
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
