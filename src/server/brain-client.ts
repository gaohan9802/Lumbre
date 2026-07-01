/**
 * MCP client for Ombre Brain.
 * Uses Streamable HTTP transport (POST /mcp with SSE responses).
 * Handles session lifecycle: init → call → re-init on expiry.
 */

const BRAIN_URL = (process.env.BRAIN_API_BASE || 'https://xiaohuo.zeabur.app').replace(/\/$/, '')
const MCP_ENDPOINT = `${BRAIN_URL}/mcp`

let sessionId: string | null = null
let reqCounter = 0

function nextId() { return ++reqCounter }

function parseSSE(raw: string): any {
  for (const line of raw.split('\n')) {
    if (line.startsWith('data: ')) {
      return JSON.parse(line.slice(6))
    }
  }
  throw new Error('No data line in SSE response: ' + raw.slice(0, 200))
}

async function initSession(): Promise<string> {
  const res = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'lumbre', version: '0.1' },
      },
      id: nextId(),
    }),
  })

  const sid = res.headers.get('mcp-session-id')
  if (!sid) throw new Error('No Mcp-Session-Id in initialize response')

  await res.text() // consume body
  sessionId = sid
  return sid
}

async function mcpCall(method: string, params: any): Promise<any> {
  if (!sessionId) await initSession()

  const doCall = async (sid: string) => {
    const res = await fetch(MCP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Mcp-Session-Id': sid,
      },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: nextId() }),
    })
    return parseSSE(await res.text())
  }

  let data = await doCall(sessionId!)

  // Session expired → re-init + retry once
  if (data.error && /session/i.test(data.error.message || '')) {
    sessionId = null
    await initSession()
    data = await doCall(sessionId!)
  }

  return data
}

/**
 * Call an Ombre Brain MCP tool. Returns the text result or error string.
 */
export async function callBrainTool(name: string, args: Record<string, any> = {}): Promise<string> {
  try {
    const data = await mcpCall('tools/call', { name, arguments: args })

    if (data.error) return `Error: ${data.error.message}`

    const content = data.result?.content
    if (Array.isArray(content)) {
      return content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
    }

    return data.result?.structuredContent?.result || JSON.stringify(data.result)
  } catch (err: any) {
    sessionId = null // reset on failure
    return `Brain MCP error: ${err.message}`
  }
}
