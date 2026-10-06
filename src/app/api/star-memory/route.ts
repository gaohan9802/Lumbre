export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  createMemoryCandidate,
  createMemoryFamily,
  getMemoryFamily,
  getStarMemoryStatus,
  listMemoryCandidates,
  listMemoryFamilies,
  recallStarMemories,
  resolveMemorySources,
  reviewMemoryCandidate,
  setCanonicalMemoryLock,
  updateCanonicalMemory,
  type CandidateDecision,
  type CandidateStatus,
} from '@/server/star-memory'

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'star_memory_error' }, { status: 400 })
}

export async function GET(req: NextRequest) {
  try {
    const view = req.nextUrl.searchParams.get('view') || 'status'
    if (view === 'status') return NextResponse.json(getStarMemoryStatus())
    if (view === 'candidates') return NextResponse.json(listMemoryCandidates((req.nextUrl.searchParams.get('status') || undefined) as CandidateStatus | undefined))
    if (view === 'families') return NextResponse.json(listMemoryFamilies())
    if (view === 'family') return NextResponse.json(getMemoryFamily(req.nextUrl.searchParams.get('id') || ''))
    if (view === 'recall') return NextResponse.json(recallStarMemories(req.nextUrl.searchParams.get('q') || '', req.nextUrl.searchParams.get('limit')))
    if (view === 'sources') return NextResponse.json(resolveMemorySources(req.nextUrl.searchParams.get('id') || ''))
    return NextResponse.json({ error: 'unknown_view' }, { status: 400 })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (body.action === 'create_candidate') return NextResponse.json(createMemoryCandidate(body.candidate, 'fire', body.owner))
    if (body.action === 'create_family') return NextResponse.json(createMemoryFamily(body.family, 'fire'))
    if (body.action === 'review_candidate') {
      return NextResponse.json(reviewMemoryCandidate(body.id, body.decision as CandidateDecision, 'fire', body.familyIds))
    }
    if (body.action === 'update_memory') return NextResponse.json(updateCanonicalMemory(body.id, body.patch, 'fire'))
    if (body.action === 'set_memory_lock') return NextResponse.json(setCanonicalMemoryLock(body.id, body.locked, 'fire'))
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (error) {
    return failure(error)
  }
}
