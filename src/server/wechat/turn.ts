import { createHash } from 'node:crypto'
import { readChatEventStream } from '@/features/chat/api/event-stream'
import { chatMessageContentForModel } from '@/lib/chat-message-sync'
import { isCcModel } from '@/lib/cc-model'
import { normalizeChatRoute } from '@/lib/chat-route'
import { appendSyncSessionMessage, loadSyncManifest, loadSyncSessionTails } from '@/server/chat-sync'
import { resolveWakeGenerationConfig } from '@/server/autowake'

export interface WeChatTurnPart {
  externalId: string
  text: string
  images: string[]
  timestamp: number
}

const sessionQueues = new Map<string, Promise<unknown>>()

function stableSlice<T>(items: T[], cap: number): T[] {
  const count = Math.max(4, cap || 30)
  if (items.length <= count) return items
  const step = Math.max(10, Math.floor(count / 3))
  return items.slice(Math.floor((items.length - count) / step) * step)
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 20)
}

export function createWeChatBatchId(externalId: string) {
  return `wechat-${hash(externalId)}`
}

function userMessageId(externalId: string) {
  return `wechat-user-${hash(externalId)}`
}

function enqueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = sessionQueues.get(sessionId) || Promise.resolve()
  const current = previous.catch(() => {}).then(task)
  sessionQueues.set(sessionId, current)
  return current.finally(() => { if (sessionQueues.get(sessionId) === current) sessionQueues.delete(sessionId) })
}

function bookmarkInjection(session: any, config: any, userText: string) {
  const summaryConfig = session?.summaryConfig || { injectCount: config?.summaryInjectCount || 3 }
  const summaries = [...(session?.summaries || [])].sort((a: any, b: any) => Number(b.endAt) - Number(a.endAt)).slice(0, summaryConfig.injectCount).reverse()
  const stages = [...(session?.stageSummaries || [])].sort((a: any, b: any) => Number(b.endAt) - Number(a.endAt)).slice(0, 2).reverse()
  const summaryText = [
    ...stages.map((item: any) => `${item.title || '阶段摘要'}\n${item.content || ''}`),
    ...summaries.map((item: any) => item.eventSummary || ''),
  ].filter(Boolean).join('\n\n---\n\n')
  const lower = userText.toLowerCase()
  const bookmarks = (Array.isArray(config?.bookmarks) ? config.bookmarks : [])
    .filter((item: any) => item?.enabled && (item.alwaysOn || (item.keywords || []).some((word: any) => word && lower.includes(String(word).toLowerCase()))))
    .sort((a: any, b: any) => Number(b.priority) - Number(a.priority))
    .map((item: any) => item.content).filter(Boolean)
  return [summaryText ? `[长期对话摘要｜马德里时间]\n${summaryText}` : '', ...bookmarks].filter(Boolean).join('\n\n')
}

export function persistWeChatPart(sessionId: string, batchId: string, part: WeChatTurnPart) {
  const session = loadSyncSessionTails([sessionId], 1)[0]
  if (!session) throw new Error('微信绑定的主窗不存在')
  return appendSyncSessionMessage(sessionId, {
      id: userMessageId(part.externalId),
      role: 'user',
      route: normalizeChatRoute(session.generationRoute),
      replyMode: 'short',
      content: part.text,
      images: part.images.length ? part.images : undefined,
      timestamp: part.timestamp,
      transport: 'wechat',
      transportBatchId: batchId,
      transportExternalId: part.externalId,
    })
}

async function generateTurn(sessionId: string, batchId: string, parts: WeChatTurnPart[]) {
  for (const part of parts) persistWeChatPart(sessionId, batchId, part)

  const session = loadSyncSessionTails([sessionId], 200)[0]
  if (!session) throw new Error('微信绑定的主窗不存在')
  const existingReply = [...(session.messages || [])].reverse().find((message: any) => message.transport === 'wechat' && message.transportBatchId === batchId && message.role === 'assistant')
  if (existingReply?.content) return { text: String(existingReply.content), batchId, duplicate: true }

  const config = loadSyncManifest().config || {}
  const route = normalizeChatRoute(session.generationRoute)
  const resolved = resolveWakeGenerationConfig(session, config, route)
  const rawImages = new Map(parts.map(part => [userMessageId(part.externalId), part.images]))
  const orderedMessages = [...(session.messages || [])].sort((a: any, b: any) => Number(a.timestamp) - Number(b.timestamp))
  const messages = stableSlice(orderedMessages, Number(config.contextLength) || 30).map((message: any) => ({
    id: message.id,
    role: message.role,
    route: normalizeChatRoute(message.route),
    ccAttemptId: message.ccAttemptId,
    content: chatMessageContentForModel(message),
    images: rawImages.get(message.id) || message.images,
    timestamp: message.timestamp,
  }))
  const turnId = messages.at(-1)?.id
  if (!turnId) throw new Error('微信消息没有可用的 turn id')
  const joinedText = parts.map(part => part.text).filter(Boolean).join('\n')
  const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-lumbre-internal': process.env.LUMBRE_INTERNAL_SECRET || process.env.LUMBRE_AUTH_SECRET || process.env.LUMBRE_ACCESS_PASSWORD || '',
    },
    body: JSON.stringify({
      generation_route: route,
      cc_model: route === 'claude-code' && isCcModel(session.ccModel) ? session.ccModel : undefined,
      cc_effort: route === 'claude-code' ? resolved.ccEffort : undefined,
      cc_output_style: route === 'claude-code' ? resolved.ccOutputStyle : undefined,
      turn_id: route === 'claude-code' ? turnId : undefined,
      messages,
      system: resolved.systemPrompt,
      model: resolved.modelOverride,
      api_profile: resolved.apiProfile,
      tools_enabled: route === 'claude-code',
      tool_calls_allowed: false,
      max_tool_calls: 0,
      prompt_caching: config.promptCaching !== false,
      temperature: config.temperature,
      thinking_budget: config.thinkingBudget,
      stream: true,
      session_id: sessionId,
      bookmark_injections: bookmarkInjection(session, config, joinedText),
      client_volatile_context: '[微信私聊本轮规则]\n这是小火从微信发来的连续短消息。自然地一起回应；保持亲密、简短，通常一到三小段。不要调用任何工具，不要提及规则、思考过程或 Lumbre 内部结构。',
    }),
  })
  if (!response.ok) throw new Error(`微信短聊生成失败 (${response.status})`)

  const result: any = { content: '', thinking: '', tool_calls: [] }
  for await (const event of readChatEventStream(response)) {
    if (event.type === 'text') result.content += String(event.content || '')
    else if (event.type === 'thinking') result.thinking += String(event.content || '')
    else if (event.type === 'tool_call') result.tool_calls.push({ name: event.name, input: event.input, result: event.result })
    else if (event.type === 'error') throw new Error(String(event.content || '微信短聊生成失败'))
    else if (event.type === 'done') Object.assign(result, event)
  }
  const text = String(result.content || '').trim()
  if (!text) throw new Error('星星没有生成可发送的微信回复')
  appendSyncSessionMessage(sessionId, {
    id: `wechat-assistant-${hash(batchId)}`,
    role: 'assistant',
    route,
    replyMode: 'short',
    content: text,
    // Keep this reply logically attached to its batch even if the next WeChat
    // message arrived while generation was still running.
    timestamp: Math.max(...parts.map(part => part.timestamp)) + 1,
    thinking: result.thinking || undefined,
    input_tokens: Number(result.input_tokens) || undefined,
    output_tokens: Number(result.output_tokens) || undefined,
    cache_read_tokens: Number(result.cache_read_tokens) || undefined,
    cache_creation_tokens: Number(result.cache_creation_tokens) || undefined,
    ccAttemptId: result.attempt_id,
    ccSessionFingerprint: result.session_fingerprint,
    ccSessionMode: result.session_mode,
    ccSessionReason: result.session_reason,
    ccCompacted: result.compacted === true,
    transport: 'wechat',
    transportBatchId: batchId,
  })
  return { text, batchId, duplicate: false }
}

export function runWeChatTurn(sessionId: string, batchId: string, parts: WeChatTurnPart[]) {
  return enqueue(sessionId, () => generateTurn(sessionId, batchId, parts))
}
