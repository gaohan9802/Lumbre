import { NextRequest, NextResponse } from 'next/server'
import { isAllowedEngawaArtUrl } from '@/server/engawa-art'
import { readEngawaHistory } from '@/server/engawa-history-store'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function GET(request: NextRequest) {
  const date = request.nextUrl.searchParams.get('date') || undefined
  const source = readEngawaHistory(date).day.daily_art?.result.image_url
  if (!isAllowedEngawaArtUrl(source)) return NextResponse.json({ error: '这一天没有可保存的今日画' }, { status: 404 })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(String(source), { cache: 'force-cache', redirect: 'error', signal: controller.signal })
    const type = response.headers.get('content-type') || ''
    const declared = Number(response.headers.get('content-length') || 0)
    if (!response.ok || !IMAGE_TYPES.has(type.split(';')[0].toLowerCase()) || declared > MAX_IMAGE_BYTES) throw new Error('invalid image')
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('image too large')
    return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' } })
  } catch {
    return NextResponse.json({ error: '今日画暂时没有加载成功' }, { status: 502 })
  } finally { clearTimeout(timer) }
}
