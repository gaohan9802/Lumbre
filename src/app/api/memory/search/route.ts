export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { searchBuckets } from '../../../../server/brain'

function formatHits(results: any[]) {
  return results.map(b => ({
    id: b.id,
    name: b.metadata.name,
    type: b.metadata.type,
    domain: b.metadata.domain,
    tags: b.metadata.tags,
    valence: b.metadata.valence,
    arousal: b.metadata.arousal,
    importance: b.metadata.importance,
    score: b.score,
    content_preview: b.content.slice(0, 200),
    pinned: b.metadata.pinned,
    resolved: b.metadata.resolved,
    created: b.metadata.created,
    last_active: b.metadata.last_active,
    activation_count: b.metadata.activation_count,
  }))
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q') || ''
  const results = searchBuckets(q)
  return NextResponse.json({ keyword_hits: formatHits(results), vector_hits: [] })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const q = body.query || body.q || ''
  const results = searchBuckets(q)
  return NextResponse.json({ keyword_hits: formatHits(results), vector_hits: [] })
}
