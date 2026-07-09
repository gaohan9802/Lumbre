import { NextRequest, NextResponse } from 'next/server'
import { loadSyncState, saveSyncState, mergeSyncState } from '@/server/chat-sync'

export const dynamic = 'force-dynamic'

// Pull-only: a device (e.g. after localStorage was cleared) can recover the
// server's copy without pushing its own (possibly empty) state first.
export async function GET() {
  try {
    return NextResponse.json(loadSyncState())
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

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
