import { randomUUID } from 'node:crypto'

const TOOL_NAMES = new Set([
  'kitchen_cook', 'kitchen_status', 'kitchen_cancel', 'kitchen_toss',
  'kitchen_buy', 'eat', 'read_menu', 'snack_eat', 'kitchen_notes',
])
const MAX_REQUEST_BYTES = 32 * 1024
const MAX_RESULT_CHARS = 64 * 1024

type KitchenetteConfig = { baseUrl: string; publicUrl: string; token: string; who: string }
type RpcReply = {
  error?: { message?: string }
  result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
}

function cleanOrigin(value: string, name: string, allowInternalHttp: boolean): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error(`${name} 不是有效地址`) }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error(`${name} 必须是干净的 HTTP(S) origin`)
  }
  if (url.protocol !== 'https:' && !loopback && !allowInternalHttp) throw new Error(`${name} 必须使用 HTTPS`)
  return url.origin
}

function configFromEnvironment(env = process.env): KitchenetteConfig | null {
  const rawBase = String(env.LUMBRE_KITCHENETTE_URL || '').trim()
  const rawPublic = String(env.LUMBRE_KITCHENETTE_PUBLIC_URL || '').trim()
  const token = String(env.LUMBRE_KITCHENETTE_TOKEN || '')
  if (!rawBase && !rawPublic && !token) return null
  if (!rawBase || !rawPublic || token.length < 32) throw new Error('小厨房地址、公网地址和 32 位以上口令必须一起配置')
  const allowInternalHttp = env.LUMBRE_KITCHENETTE_ALLOW_INSECURE_HTTP === '1'
  const who = String(env.LUMBRE_KITCHENETTE_WHO || '星星').trim()
  if (!who || who.length > 64 || Array.from(who).some(char => char.charCodeAt(0) < 32)) throw new Error('小厨房角色名无效')
  return {
    baseUrl: cleanOrigin(rawBase, 'LUMBRE_KITCHENETTE_URL', allowInternalHttp),
    publicUrl: cleanOrigin(rawPublic, 'LUMBRE_KITCHENETTE_PUBLIC_URL', false),
    token,
    who,
  }
}

function parseReply(body: string): RpcReply {
  const event = body.split(/\r?\n/).find(line => line.startsWith('data:'))?.slice(5).trim()
  const payload = event || body
  if (!payload) return {}
  try { return JSON.parse(payload) as RpcReply } catch { throw new Error('小厨房返回了无法识别的响应') }
}

async function rpc(config: KitchenetteConfig, method: string, params: Record<string, unknown>, sessionId?: string, notification = false) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 35_000)
  try {
    const response = await fetch(`${config.baseUrl}/mcp`, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${config.token}`,
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: randomUUID() }), method, params }),
    })
    if (!response.ok) throw new Error(`小厨房请求失败（${response.status}）`)
    return { reply: parseReply(await response.text()), sessionId: response.headers.get('mcp-session-id') || sessionId }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('小厨房响应超时')
    throw error
  } finally { clearTimeout(timer) }
}

export function kitchenetteBrowserConfig() {
  const config = configFromEnvironment()
  return config ? { pageUrl: config.publicUrl, credential: config.token, who: config.who } : null
}

export function kitchenetteConfigured(): boolean {
  try { return configFromEnvironment() !== null } catch { return false }
}

export async function executeKitchenetteTool(name: string, input: Record<string, unknown>): Promise<string> {
  if (!TOOL_NAMES.has(name)) throw new Error('未知的小厨房工具')
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('小厨房工具参数必须是对象')
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_REQUEST_BYTES) throw new Error('小厨房操作参数过大')
  const config = configFromEnvironment()
  if (!config) throw new Error('小厨房尚未配置')

  const initialized = await rpc(config, 'initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lumbre', version: '1.0.0' },
  })
  if (initialized.reply.error) throw new Error(initialized.reply.error.message || '小厨房初始化失败')
  await rpc(config, 'notifications/initialized', {}, initialized.sessionId, true)
  const called = await rpc(config, 'tools/call', { name, arguments: { ...input, who: config.who } }, initialized.sessionId)
  if (called.reply.error) throw new Error(called.reply.error.message || '小厨房调用失败')
  const result = called.reply.result
  const text = result?.content?.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n') || ''
  if (result?.isError) throw new Error(text.slice(0, 500) || '小厨房操作失败')
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n（返回内容过长，已截断）` : text
}
