import { NextRequest, NextResponse } from 'next/server'
import { getTodos, listReceiptDays } from '@/server/todo-store'
export const dynamic = 'force-dynamic'
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') || undefined
  return NextResponse.json({ day: getTodos(date), receiptDays: listReceiptDays() })
}
