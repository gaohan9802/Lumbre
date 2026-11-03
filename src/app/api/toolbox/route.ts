import { NextRequest, NextResponse } from 'next/server'
import { toolCatalogSnapshot, updateToolCatalog } from '@/server/tool-catalog'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(toolCatalogSnapshot(), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    return NextResponse.json(updateToolCatalog(body?.changes))
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '工具箱保存失败' }, { status: 400 })
  }
}
