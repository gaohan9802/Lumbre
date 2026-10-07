export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  createMemoryCandidate,
  createMemoryFamily,
  endMemoryFamily,
  getMemoryFamily,
  getMemoryFamilyLevel,
  getStarMemoryStatus,
  listCanonicalMemories,
  listMemoryCandidates,
  listMemoryFamilies,
  listRecycledFamilies,
  listRecycledMemories,
  listWorkingMemories,
  mergeMemoryFamilies,
  recallStarMemoryBundle,
  resolveMemorySources,
  resolveWorkingMemorySources,
  reviewMemoryCandidate,
  reviewWorkingMemory,
  setCanonicalMemoryLock,
  setMemoryFamilyLock,
  setMemoryFamilyMembership,
  splitMemoryFamily,
  removeMemoryFamilyMembership,
  recycleMemoryFamily,
  recycleCanonicalMemory,
  restoreMemoryFamily,
  restoreCanonicalMemory,
  updateCanonicalMemory,
  updateMemoryFamily,
  type CandidateDecision,
  type CandidateStatus,
  type WorkingMemoryDecision,
  type WorkingMemoryStatus,
} from '@/server/star-memory'

function failure(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : 'star_memory_error' }, { status: 400 })
}

export async function GET(req: NextRequest) {
  try {
    const view = req.nextUrl.searchParams.get('view') || 'status'
    if (view === 'status') return NextResponse.json(getStarMemoryStatus())
    if (view === 'candidates') return NextResponse.json(listMemoryCandidates((req.nextUrl.searchParams.get('status') || undefined) as CandidateStatus | undefined))
    if (view === 'memories') return NextResponse.json(listCanonicalMemories())
    if (view === 'working') return NextResponse.json(listWorkingMemories((req.nextUrl.searchParams.get('status') || undefined) as WorkingMemoryStatus | undefined))
    if (view === 'families') return NextResponse.json(listMemoryFamilies())
    if (view === 'family_trash') return NextResponse.json(listRecycledFamilies())
    if (view === 'memory_trash') return NextResponse.json(listRecycledMemories())
    if (view === 'family') {
      const level = req.nextUrl.searchParams.get('level')
      return NextResponse.json(level ? getMemoryFamilyLevel(req.nextUrl.searchParams.get('id') || '', level) : getMemoryFamily(req.nextUrl.searchParams.get('id') || ''))
    }
    if (view === 'recall') return NextResponse.json(recallStarMemoryBundle(req.nextUrl.searchParams.get('q') || '', req.nextUrl.searchParams.get('limit')))
    if (view === 'sources') return NextResponse.json(resolveMemorySources(req.nextUrl.searchParams.get('id') || ''))
    if (view === 'working_sources') return NextResponse.json(resolveWorkingMemorySources(req.nextUrl.searchParams.get('id') || ''))
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
    if (body.action === 'review_working') return NextResponse.json(reviewWorkingMemory(body.id, body.decision as WorkingMemoryDecision, 'fire', new Date().toISOString(), body.summary))
    if (body.action === 'update_family') return NextResponse.json(updateMemoryFamily(body.id, body.patch, 'fire'))
    if (body.action === 'set_family_lock') return NextResponse.json(setMemoryFamilyLock(body.id, body.locked, 'fire'))
    if (body.action === 'set_family_member') return NextResponse.json(setMemoryFamilyMembership(body.id, body.memoryId, body.role, body.reason, 'fire'))
    if (body.action === 'remove_family_member') return NextResponse.json({ removed: removeMemoryFamilyMembership(body.id, body.memoryId, 'fire') })
    if (body.action === 'end_family') return NextResponse.json(endMemoryFamily(body.id, 'fire'))
    if (body.action === 'recycle_family') return NextResponse.json(recycleMemoryFamily(body.id, 'fire'))
    if (body.action === 'restore_family') return NextResponse.json(restoreMemoryFamily(body.recycleId, 'fire'))
    if (body.action === 'merge_families') return NextResponse.json(mergeMemoryFamilies(body.sourceId, body.targetId, body.summary, 'fire'))
    if (body.action === 'split_family') return NextResponse.json(splitMemoryFamily(body.sourceId, body.family, body.memoryIds, 'fire'))
    if (body.action === 'recycle_memory') return NextResponse.json(recycleCanonicalMemory(body.id, 'fire'))
    if (body.action === 'restore_memory') return NextResponse.json(restoreCanonicalMemory(body.recycleId, 'fire'))
    return NextResponse.json({ error: 'unknown_action' }, { status: 400 })
  } catch (error) {
    return failure(error)
  }
}
