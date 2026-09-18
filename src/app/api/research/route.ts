import { NextRequest, NextResponse } from 'next/server'
import { readResearchTopic, researchOverview } from '@/server/research-store'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const topicId = request.nextUrl.searchParams.get('topic_id')
    if (!topicId) return NextResponse.json(researchOverview())
    const offset = Number(request.nextUrl.searchParams.get('offset') || 0)
    return NextResponse.json(readResearchTopic(topicId, offset))
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'research_error' }, { status: 404 })
  }
}
