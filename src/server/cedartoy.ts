import { randomUUID } from 'node:crypto'

const PUBLIC_ENDPOINT = 'https://toy.cedarstar.org/'
const STATEFUL_TOOLS = new Set(['play', 'account'])
const ACCOUNT_ACTIONS = new Set([
  'get_profile',
  'get_bindings',
  'my_saves',
  'generate_binding_token',
  'set_avatar',
  'delete_save',
])
const MAX_REQUEST_BYTES = 32 * 1024
const MAX_RESULT_CHARS = 64 * 1024

type RpcReply = {
  error?: { code?: number; message?: string; data?: unknown }
  result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean; [key: string]: unknown }
}

function configuredEndpoint(): string | null {
  const raw = process.env.LUMBRE_CEDARTOY_MCP_URL?.trim()
  if (!raw) return null
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.hostname !== 'toy.cedarstar.org' || url.username || url.password || url.search || url.hash) {
    throw new Error('LUMBRE_CEDARTOY_MCP_URL 必须是 toy.cedarstar.org 的 HTTPS MCP 地址')
  }
  if (!/^\/[A-Za-z0-9._~-]{8,256}\/?$/.test(url.pathname)) {
    throw new Error('LUMBRE_CEDARTOY_MCP_URL 缺少有效的账号 Token 路径')
  }
  return url.toString()
}

export function cedarToyConfigured(): boolean {
  try { return configuredEndpoint() !== null } catch { return false }
}

function parseReply(body: string): RpcReply {
  const payload = body.startsWith('data:')
    ? body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).find(Boolean) || ''
    : body
  if (!payload) return {}
  try { return JSON.parse(payload) as RpcReply } catch { throw new Error('CedarToy 返回了无法识别的响应') }
}

async function rpc(endpoint: string, method: string, params: Record<string, unknown>, sessionId?: string): Promise<{ reply: RpcReply; sessionId?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method, params }),
    })
    if (!response.ok) throw new Error(`CedarToy 请求失败（${response.status}）`)
    return { reply: parseReply(await response.text()), sessionId: response.headers.get('mcp-session-id') || sessionId }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('CedarToy 响应超时')
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function validateInput(name: string, input: Record<string, any>) {
  if (name === 'get_guide' || name === 'play') {
    if (typeof input.game !== 'string' || !input.game.trim() || input.game.length > 80) throw new Error('game 必须是有效的游戏名')
  }
  if (name === 'play' && (typeof input.action !== 'string' || !input.action.trim() || input.action.length > 120)) throw new Error('action 必须是有效的游戏操作')
  if (name === 'play' && input.params !== undefined && (!input.params || typeof input.params !== 'object' || Array.isArray(input.params))) throw new Error('params 必须是对象')
  if (name === 'account' && !ACCOUNT_ACTIONS.has(String(input.action || ''))) throw new Error('这个账号操作没有开放给星星')
  if (name === 'account' && input.action === 'set_avatar' && (typeof input.avatar !== 'string' || !input.avatar || input.avatar.length > 16)) throw new Error('avatar 必须是 1–16 个字符')
  if (name === 'account' && input.action === 'delete_save' && (typeof input.game !== 'string' || !input.game || !Number.isInteger(input.slot) || input.slot < 1 || input.slot > 5)) throw new Error('删除存档需要 game 和 1–5 的 slot')
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_REQUEST_BYTES) throw new Error('CedarToy 操作参数过大')
}

export async function executeCedarToyTool(name: string, input: Record<string, any>): Promise<string> {
  const remoteName = name.replace(/^cedar_/, '')
  if (!['list_games', 'get_guide', 'play', 'account'].includes(remoteName)) throw new Error('未知的 CedarToy 工具')
  validateInput(remoteName, input)

  const configured = configuredEndpoint()
  if (STATEFUL_TOOLS.has(remoteName) && !configured) throw new Error('CedarToy 账号尚未绑定；请先在小游戏房间完成账号配置')
  const endpoint = configured || PUBLIC_ENDPOINT
  const initialized = await rpc(endpoint, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'lumbre', version: '1.0.0' },
  })
  if (initialized.reply.error) throw new Error(initialized.reply.error.message || 'CedarToy 初始化失败')
  const remoteInput = remoteName === 'account' && input.action === 'delete_save' ? { ...input, confirm: true } : input
  const called = await rpc(endpoint, 'tools/call', { name: remoteName, arguments: remoteInput }, initialized.sessionId)
  if (called.reply.error) throw new Error(called.reply.error.message || 'CedarToy 调用失败')
  const result = called.reply.result
  const text = result?.content?.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n')
    || JSON.stringify(result || {})
  if (result?.isError) throw new Error(text.slice(0, 500) || 'CedarToy 操作失败')
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n（返回内容过长，已截断）` : text
}
