import { NextRequest, NextResponse } from 'next/server'
import { loadSyncManifest, loadSyncSessions, loadSyncState, mergeSyncDelta } from '@/server/chat-sync'

export const dynamic = 'force-dynamic'

function json(data: any) {
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' } })
}

export async function GET(req: NextRequest) {
  try {
    const mode = req.nextUrl.searchParams.get('mode')
    if (mode === 'manifest') {
      const state = loadSyncManifest()
      const clientConfigAt = Number(req.nextUrl.searchParams.get('configUpdatedAt') || 0)
      const includeConfig = state.configUpdatedAt > clientConfigAt
      return json({
        sessions: state.sessions,
        tombstones: state.tombstones,
        configUpdatedAt: state.configUpdatedAt,
        ...(includeConfig ? { config: state.config } : {}),
      })
    }
    if (mode === 'sessions') {
      const ids = (req.nextUrl.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0, 50)
      const state = loadSyncManifest()
      return json({ sessions: loadSyncSessions(ids), tombstones: state.tombstones })
    }
    // Full GET stays available to old clients, but current clients never use it.
    return json(loadSyncState())
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'sync failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const client = {
      sessions: Array.isArray(body.sessions) ? body.sessions : [],
      tombstones: body.tombstones && typeof body.tombstones === 'object' ? body.tombstones : {},
      config: body.config,
      configUpdatedAt: typeof body.configUpdatedAt === 'number' ? body.configUpdatedAt : 0,
    }
    const merged = mergeSyncDelta(client)

    if (body.responseMode === 'delta') {
      const known = new Map<string, number>()
      for (const item of Array.isArray(body.knownSessions) ? body.knownSessions : []) {
        if (item?.id) known.set(item.id, Number(item.updatedAt) || 0)
      }
      const needed = merged.sessions.filter(s => (known.get(s.id) ?? -1) < s.updatedAt).map(s => s.id)
      const clientConfigAt = Number(body.knownConfigUpdatedAt || 0)
      const includeConfig = merged.configUpdatedAt > clientConfigAt
      return json({
        sessions: loadSyncSessions(needed),
        tombstones: merged.tombstones,
        manifest: merged.sessions,
        configUpdatedAt: merged.configUpdatedAt,
        ...(includeConfig ? { config: merged.config } : {}),
      })
    }
    return json(loadSyncState())
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'sync failed' }, { status: 500 })
  }
}
