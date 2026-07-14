/**
 * Galatea Garden 论坛 + 桌游 MCP 桥接。
 * Lumbre 侧只暴露一个 `galatea` 工具给星星，转发到 Galatea 自带的子工具。
 * 参考 galatea_module.py（心跳系统用的同一套接口）。
 */

const GALATEA_URL = process.env.GALATEA_URL || 'https://galatea.abysslumina.com/mcp'
const GALATEA_TOKEN = process.env.GALATEA_TOKEN || 'gg_wPEkrMHPvqs68YbYxHIgpwl9BsHn8ZTYKwJbc1t-wuk'

/** Galatea 自带的子工具白名单（透传的 tool 名） */
export const GALATEA_SUBTOOLS = new Set([
  // 论坛
  'get_self', 'list_threads', 'get_thread', 'create_thread', 'create_reply',
  'delete_thread', 'delete_reply', 'interact', 'list_notifications', 'list_activity',
  // 桌游
  'list_games', 'join_game', 'get_my_status', 'start_game', 'submit_action',
  'send_game_chat', 'get_tool_schema', 'get_game_summary', 'leave_waiting_game',
])

async function callGalatea(tool: string, args: Record<string, any>): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 25000)
  try {
    const res = await fetch(GALATEA_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${GALATEA_TOKEN}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0', id: '1', method: 'tools/call',
        params: { name: tool, arguments: args || {} },
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    const text = await res.text()
    // 兼容 SSE：从 data: 行里抠 JSON
    let payload: any = null
    try {
      payload = JSON.parse(text)
    } catch {
      const line = text.split('\n').find(l => l.trim().startsWith('data:'))
      if (line) {
        try { payload = JSON.parse(line.replace(/^data:\s*/, '')) } catch { /* noop */ }
      }
    }
    if (!payload) return `Galatea HTTP ${res.status}: ${text.slice(0, 500)}`
    if (payload.error) return `Galatea 错误: ${JSON.stringify(payload.error)}`
    const content = payload.result?.content
    if (Array.isArray(content)) {
      const combined = content.map((c: any) => c?.text ?? '').join('\n').trim()
      return combined || JSON.stringify(payload.result)
    }
    return JSON.stringify(payload.result ?? payload)
  } catch (err: any) {
    clearTimeout(timer)
    if (err?.name === 'AbortError') return 'Galatea 请求超时（25s）'
    return `Galatea 请求失败: ${err.message}`
  }
}

/** 星星调用的入口：{ tool, args } → 转发到 Galatea 子工具 */
export async function executeGalatea(input: Record<string, any>): Promise<string> {
  const tool = input?.tool
  if (!tool || typeof tool !== 'string') {
    return '请提供 tool（Galatea 子工具名，如 list_threads / get_thread / create_thread）'
  }
  if (!GALATEA_SUBTOOLS.has(tool)) {
    return `未知的 Galatea 子工具: ${tool}。可用: ${Array.from(GALATEA_SUBTOOLS).join(', ')}`
  }
  const args = (input.args && typeof input.args === 'object') ? input.args : {}
  const out = await callGalatea(tool, args)
  const CAP = 8000
  return out.length > CAP ? out.slice(0, CAP) + '\n…(truncated)' : out
}
