import { NextRequest, NextResponse } from 'next/server'
import { createToolContext } from '@/server/agent/context'
import { executeTool } from '@/server/agent/executor'
import { localizeToolTimes, toolResultContent, toolResultForHistory } from '@/server/agent/results'
import { toolsForContext } from '@/server/agent/registry'
import { isTrustedCcToolBridgeRequest } from '@/server/chat/cc-tool-bridge-auth'

export const runtime = 'nodejs'
export const maxDuration = 120

const SAFE_ID = /^[A-Za-z0-9._:-]{1,180}$/
const MAX_INPUT_BYTES = 64 * 1024

function response(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

function authorized(request: NextRequest) {
  return isTrustedCcToolBridgeRequest(request.headers.get('authorization'))
}

function validSessionId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID.test(value)
}

function context(sessionId: string, source: unknown) {
  const unattended = source === 'unattended-wake'
  return createToolContext({
    actorId: unattended ? 'lumbre-autowake-service' : 'lumbre-authenticated-user',
    sessionId,
    source: unattended ? 'unattended-wake' : 'chat',
  })
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return response({ error: 'unauthorized' }, 401)
  const sessionId = request.nextUrl.searchParams.get('session_id')
  if (!validSessionId(sessionId)) return response({ error: 'invalid_session_id' }, 400)
  const tools = toolsForContext(context(sessionId, request.nextUrl.searchParams.get('source'))).map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema,
  }))
  return response({ tools })
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return response({ error: 'unauthorized' }, 401)
  const declared = Number(request.headers.get('content-length') || 0)
  if (declared > MAX_INPUT_BYTES) return response({ error: 'request_too_large' }, 413)
  try {
    const body = await request.json()
    if (!validSessionId(body?.session_id)) return response({ error: 'invalid_session_id' }, 400)
    if (typeof body?.name !== 'string' || !/^[A-Za-z0-9_:-]{1,120}$/.test(body.name)) {
      return response({ error: 'invalid_tool_name' }, 400)
    }
    const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {}
    if (Buffer.byteLength(JSON.stringify(input)) > MAX_INPUT_BYTES) return response({ error: 'request_too_large' }, 413)

    const raw = localizeToolTimes(await executeTool(body.name, input, context(body.session_id, body.source)))
    const result = toolResultForHistory(body.name, raw)
    const error = raw.startsWith('Tool denied:') || raw.startsWith('Tool error')
    return response({
      name: body.name,
      result,
      content: toolResultContent(body.name, raw),
      isError: error,
    })
  } catch {
    return response({ error: 'tool_bridge_failed' }, 500)
  }
}
