import { NextRequest, NextResponse } from 'next/server'
import { getStudyAsset } from '@/server/study-store'

export const dynamic = 'force-dynamic'

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { asset, bytes } = getStudyAsset(params.id)
    return new NextResponse(new Uint8Array(bytes).buffer, { headers: { 'Content-Type': asset.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' } })
  } catch {
    return NextResponse.json({ error: 'study_asset_not_found' }, { status: 404 })
  }
}
