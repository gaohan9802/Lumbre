import { NextRequest, NextResponse } from 'next/server'
import { loadSyncState, saveSyncState, mergeSyncState } from '@/server/chat-sync'

// Push+pull combined: client sends sessions+config, server merges and returns merged state.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const client = {
      sessions: Array.isArray(body.sessions) ? body.sessions : [],
      tombstones: body.tombstones && typeof body.tombstones === 'object' ? body.tombstones : {},
      config: body.config,
      configUpdatedAt: typeof body.configUpdatedAt === 'number' ? body.configUpdatedAt : 0,
    }
    const merged = mergeSyncState(loadSyncState(), client)
    saveSyncState(merged)
    return NextResponse.json(merged)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
