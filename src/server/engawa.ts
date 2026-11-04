import { randomUUID } from 'node:crypto'
import { archiveEngawaResult } from './engawa-history-store'
import { incrementRoomUnread } from './room-unread-store'

export const ENGAWA_TOOL_NAMES = [
  'web_read', 'rss_read', 'shelf', 'shelf_add', 'shelf_suggest', 'shelf_remove',
  'sky_tonight', 'apod', 'daily_art', 'arxiv_new', 'daily_poem', 'on_this_day',
  'hobby_corner', 'hobby_add', 'hobby_remove',
] as const

const ENDPOINT = 'http://engawa:8799/mcp'
const MAX_REQUEST_BYTES = 32 * 1024
const MAX_RESULT_CHARS = 64 * 1024

type RpcReply = {
  error?: { message?: string }
  result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean; [key: string]: unknown }
}

function parseReply(body: string): RpcReply {
  const eventData = body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).find(Boolean)
  const payload = eventData || body
  if (!payload) return {}
  try { return JSON.parse(payload) as RpcReply } catch { throw new Error('豹子的窗台返回了无法识别的响应') }
}

async function rpc(method: string, params: Record<string, unknown>, sessionId?: string, notification = false) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 35_000)
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: randomUUID() }), method, params }),
    })
    if (!response.ok) throw new Error(`豹子的窗台请求失败（${response.status}）`)
    return { reply: parseReply(await response.text()), sessionId: response.headers.get('mcp-session-id') || sessionId }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('豹子的窗台响应超时')
    throw error
  } finally { clearTimeout(timer) }
}

export async function executeEngawaTool(name: string, input: Record<string, unknown>, notifyRoom = false): Promise<string> {
  if (!ENGAWA_TOOL_NAMES.includes(name as typeof ENGAWA_TOOL_NAMES[number])) throw new Error('未知的窗台工具')
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('窗台工具参数必须是对象')
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > MAX_REQUEST_BYTES) throw new Error('窗台工具参数过大')

  const initialized = await rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lumbre', version: '1.0.0' },
  })
  if (initialized.reply.error) throw new Error(initialized.reply.error.message || '豹子的窗台初始化失败')
  await rpc('notifications/initialized', {}, initialized.sessionId, true)
  const called = await rpc('tools/call', { name, arguments: input }, initialized.sessionId)
  if (called.reply.error) throw new Error(called.reply.error.message || '豹子的窗台调用失败')
  const result = called.reply.result
  const text = result?.content?.filter(item => item.type === 'text' && typeof item.text === 'string').map(item => item.text).join('\n')
    || JSON.stringify(result || {})
  if (result?.isError) throw new Error(text.slice(0, 500) || '豹子的窗台操作失败')
  const bounded = text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n（返回内容过长，已截断）` : text
  if (archiveEngawaResult(name, input, bounded) && notifyRoom) incrementRoomUnread('engawa')
  return bounded
}
