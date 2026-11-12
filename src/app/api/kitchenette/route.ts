import { NextResponse } from 'next/server'
import { kitchenetteBrowserConfig } from '@/server/kitchenette'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const config = kitchenetteBrowserConfig()
    if (!config) return NextResponse.json({ error: '小厨房尚未配置' }, { status: 503 })
    return NextResponse.json(config, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '小厨房配置无效' }, { status: 503 })
  }
}
