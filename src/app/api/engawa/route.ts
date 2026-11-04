import { NextRequest, NextResponse } from 'next/server'
import { readEngawaHistory } from '@/server/engawa-history-store'
import { executeEngawaTool } from '@/server/engawa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const FRONTEND_TOOLS = new Set(['web_read', 'rss_read', 'shelf', 'shelf_suggest', 'sky_tonight', 'apod', 'daily_art', 'arxiv_new', 'daily_poem', 'on_this_day', 'hobby_corner'])

export async function GET(request: NextRequest) {
  return NextResponse.json(readEngawaHistory(request.nextUrl.searchParams.get('date') || undefined), { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const tool = String(body.tool || '')
    if (!FRONTEND_TOOLS.has(tool)) return NextResponse.json({ error: '这个窗台操作只能由星星通过正式工具完成' }, { status: 403 })
    const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {}
    const raw = await executeEngawaTool(tool, input)
    let result: unknown = raw
    try { result = JSON.parse(raw) } catch {}
    return NextResponse.json({ tool, result, captured_at: new Date().toISOString() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '窗台暂时打不开' }, { status: 400 })
  }
}
