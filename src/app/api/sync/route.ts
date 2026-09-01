import { NextRequest, NextResponse } from 'next/server'
import {
  loadSyncManifest, loadSyncSessionHistory, loadSyncSessions, loadSyncSessionTails,
  loadSyncState, mergeSyncDelta, upsertSyncSessionMessage,
} from '@/server/chat-sync'

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
    if (mode === 'tails') {
      const ids = (req.nextUrl.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0, 50)
      const limit = Number(req.nextUrl.searchParams.get('limit') || 120)
      const state = loadSyncManifest()
      return json({ sessions: loadSyncSessionTails(ids, limit), tombstones: state.tombstones })
    }
    if (mode === 'history') {
      const id = req.nextUrl.searchParams.get('id') || ''
      const before = Number(req.nextUrl.searchParams.get('before') || 0)
      const limit = Number(req.nextUrl.searchParams.get('limit') || 50)
      const page = id ? loadSyncSessionHistory(id, before, limit) : null
      if (!page) return NextResponse.json({ error: 'session not found' }, { status: 404 })
      return json(page)
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
    if (body.action === 'append_message' && body.sessionId && body.message?.id) {
      return json({ ok: true, ...upsertSyncSessionMessage(String(body.sessionId), body.message, body.sessionMeta || {}) })
    }
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
        sessions: loadSyncSessionTails(needed, 120),
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
