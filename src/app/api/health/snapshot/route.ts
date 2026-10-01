import { NextRequest, NextResponse } from 'next/server'
import { HealthInputError, saveHealthSnapshot } from '@/server/data/repositories/health'
import { isTrustedHealthSyncRequest } from '@/server/health-sync-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_INPUT_BYTES = 4 * 1024

function response(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  if (!isTrustedHealthSyncRequest(
    request.headers.get('authorization'),
    request.headers.get('x-lumbre-health-token'),
  )) {
    return response({ error: 'unauthorized' }, 401)
  }
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > MAX_INPUT_BYTES) return response({ error: 'request_too_large' }, 413)

  try {
    const raw = await request.text()
    if (Buffer.byteLength(raw) > MAX_INPUT_BYTES) return response({ error: 'request_too_large' }, 413)
    const day = saveHealthSnapshot(JSON.parse(raw))
    return response({ ok: true, day })
  } catch (error) {
    if (error instanceof HealthInputError || error instanceof SyntaxError) {
      return response({ error: error.message }, 400)
    }
    return response({ error: 'health_sync_failed' }, 500)
  }
}
