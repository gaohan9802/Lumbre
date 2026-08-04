import { NextRequest, NextResponse } from 'next/server'
import { loadSyncState, saveSyncState, mergeSyncState } from '@/server/chat-sync'

export const dynamic = 'force-dynamic'

function manifestOf(sessions: any[]) {
  return sessions.map((s: any) => ({
    id: s.id,
    updatedAt: Number(s.updatedAt) || 0,
    messageCount: Array.isArray(s.messages) ? s.messages.length : 0,
  }))
}

function json(data: any) {
  return NextResponse.json(data, {
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}

// Incremental pull modes keep a long chat history from being downloaded and
// parsed on every app resume. The legacy full GET remains for compatibility.
export async function GET(req: NextRequest) {
  try {
    const state = loadSyncState()
    const mode = req.nextUrl.searchParams.get('mode')

    if (mode === 'manifest') {
      const clientConfigAt = Number(req.nextUrl.searchParams.get('configUpdatedAt') || 0)
      const includeConfig = (state.configUpdatedAt || 0) > clientConfigAt
      return json({
        sessions: manifestOf(state.sessions),
        tombstones: state.tombstones,
        configUpdatedAt: state.configUpdatedAt || 0,
        ...(includeConfig ? { config: state.config } : {}),
      })
    }

    if (mode === 'sessions') {
      const ids = new Set((req.nextUrl.searchParams.get('ids') || '').split(',').filter(Boolean))
      return json({
        sessions: state.sessions.filter((s: any) => ids.has(s.id)),
        tombstones: state.tombstones,
      })
    }

    return json(state)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// Push+pull combined. responseMode=delta returns only sessions newer than the
// client's compact manifest instead of echoing the complete archive.
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

    if (body.responseMode === 'delta') {
      const known = new Map<string, number>()
      for (const item of Array.isArray(body.knownSessions) ? body.knownSessions : []) {
        if (item?.id) known.set(item.id, Number(item.updatedAt) || 0)
      }
      const sessions = merged.sessions.filter((s: any) => (known.get(s.id) ?? -1) < (Number(s.updatedAt) || 0))
      const clientConfigAt = Number(body.knownConfigUpdatedAt || 0)
      const includeConfig = (merged.configUpdatedAt || 0) > clientConfigAt
      return json({
        sessions,
        tombstones: merged.tombstones,
        manifest: manifestOf(merged.sessions),
        configUpdatedAt: merged.configUpdatedAt || 0,
        ...(includeConfig ? { config: merged.config } : {}),
      })
    }

    return json(merged)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
