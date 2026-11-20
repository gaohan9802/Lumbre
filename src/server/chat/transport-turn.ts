import { createHash } from 'node:crypto'
import { readChatEventStream } from '@/features/chat/api/event-stream'
import { formatBookmarkBlock, getTriggeredBookmarks } from '@/features/chat/summaries/bookmarks'
import { chatMessageContentForModel } from '@/lib/chat-message-sync'
import { isCcModel } from '@/lib/cc-model'
import { normalizeChatRoute } from '@/lib/chat-route'
import { normalizeChatWindowRole } from '@/lib/chat-window-role'
import { appendSyncSessionMessage, loadSyncManifest, loadSyncMessageContext, loadSyncSessionTails } from '@/server/chat-sync'
import { resolveWakeGenerationConfig } from '@/server/autowake'

type Transport = 'wechat' | 'stackchan'

const turnRules: Record<Transport, string> = {
  wechat: '[微信私聊本轮规则]\n这是小火从微信发来的连续短消息。自然地一起回应；保持亲密、简短，通常一到三小段。不要调用任何工具，不要提及规则、思考过程或 Lumbre 内部结构。',
  stackchan: '[StackChan 语音对话]\n这是小火说话的转写。像当面说话一样自然回应，通常一到三句，回答会直接朗读。只输出你想说的话，避免 Markdown、表情符号和舞台描述。',
}

export interface TransportTurnPart {
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

export function createTransportBatchId(transport: Transport, externalId: string) {
  return `${transport}-${hash(externalId)}`
}

function userMessageId(transport: Transport, externalId: string) {
  return `${transport}-user-${hash(externalId)}`
}

function enqueue<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
  const previous = sessionQueues.get(sessionId) || Promise.resolve()
  const current = previous.catch(() => {}).then(task)
  sessionQueues.set(sessionId, current)
  return current.finally(() => { if (sessionQueues.get(sessionId) === current) sessionQueues.delete(sessionId) })
}

function bookmarkInjection(session: any, config: any, userText: string) {
  const lower = userText.toLowerCase()
  const bookmarks = (Array.isArray(config?.bookmarks) ? config.bookmarks : [])
    .filter((item: any) => item?.enabled && (item.alwaysOn || (item.keywords || []).some((word: any) => word && lower.includes(String(word).toLowerCase()))))
    .sort((a: any, b: any) => Number(b.priority) - Number(a.priority))
    .map((item: any) => item.content).filter(Boolean)
  return bookmarks.join('\n\n')
}

export function persistTransportPart(transport: Transport, sessionId: string, batchId: string, part: TransportTurnPart) {
  const session = loadSyncSessionTails([sessionId], 1)[0]
  if (!session) throw new Error(transport === 'wechat' ? '微信绑定的主窗不存在' : 'StackChan 绑定的聊天窗不存在')
  if (transport === 'stackchan' && normalizeChatWindowRole(session.windowRole) !== 'chat') {
    throw new Error('StackChan 需要绑定到日常聊天窗')
  }
  if (transport === 'stackchan' && session.generationRoute !== 'claude-code') {
    throw new Error('StackChan 需要可续接的 CC 会话')
  }
  return appendSyncSessionMessage(sessionId, {
    id: userMessageId(transport, part.externalId),
    role: 'user',
    route: normalizeChatRoute(session.generationRoute),
    replyMode: 'short',
    content: part.text,
    images: part.images.length ? part.images : undefined,
    timestamp: part.timestamp,
    transport,
    transportBatchId: batchId,
    transportExternalId: part.externalId,
  })
}

async function generateTurn(transport: Transport, sessionId: string, batchId: string, parts: TransportTurnPart[]) {
  const persisted = parts.map(part => persistTransportPart(transport, sessionId, batchId, part))

  const session = loadSyncSessionTails([sessionId], 200)[0]
  if (!session) throw new Error(transport === 'wechat' ? '微信绑定的主窗不存在' : 'StackChan 绑定的聊天窗不存在')
  const assistantId = `${transport}-assistant-${hash(batchId)}`
  const existingReply = [...(session.messages || [])].reverse().find((message: any) => message.transport === transport && message.transportBatchId === batchId && message.role === 'assistant')
    || (transport === 'stackchan' && !persisted[0].appended
      ? loadSyncMessageContext(sessionId, assistantId)?.messages.find((message: any) => message.id === assistantId)
      : undefined)
  if (existingReply?.content) return { text: String(existingReply.content), batchId, duplicate: true }

  const config = loadSyncManifest().config || {}
  const route = normalizeChatRoute(session.generationRoute)
  const defaultModel = process.env.LUMBRE_CC_MODEL
  const ccModel = isCcModel(session.ccModel) ? session.ccModel
    : transport === 'stackchan' && isCcModel(defaultModel) ? defaultModel : undefined
  const resolved = resolveWakeGenerationConfig({ ...session, ccModel }, config, route)
  const rawImages = new Map(parts.map(part => [userMessageId(transport, part.externalId), part.images]))
  const orderedMessages = [...(session.messages || [])].sort((a: any, b: any) => Number(a.timestamp) - Number(b.timestamp))
  let turnMessages = orderedMessages
  let replyTimestamp = Math.max(...parts.map(part => part.timestamp)) + 1
  if (transport === 'stackchan') {
    const turnIndex = orderedMessages.findIndex(message => message.id === userMessageId(transport, parts[0].externalId))
    if (turnIndex < 0) throw new Error('StackChan 消息不在当前聊天记录中')
    turnMessages = orderedMessages.slice(0, turnIndex + 1)
    replyTimestamp = Number(orderedMessages[turnIndex].timestamp) + 1
  }
  const contextHistory = transport === 'stackchan' ? turnMessages : stableSlice(turnMessages, Number(config.contextLength) || 30)
  const messages = contextHistory.map((message: any) => ({
    id: message.id,
    role: message.role,
    route: normalizeChatRoute(message.route),
    ccAttemptId: message.ccAttemptId,
    content: chatMessageContentForModel(message),
    images: rawImages.get(message.id) || message.images,
    timestamp: message.timestamp,
  }))
  const turnId = messages.at(-1)?.id
  if (!turnId) throw new Error(transport === 'wechat' ? '微信消息没有可用的 turn id' : 'StackChan 消息没有可用的 turn id')
  const joinedText = parts.map(part => part.text).filter(Boolean).join('\n')
  const transportLabel = transport === 'wechat' ? '微信短聊' : 'StackChan 语音'
  const triggered = transport === 'stackchan' && Array.isArray(config.bookmarks)
    ? getTriggeredBookmarks(config.bookmarks, turnMessages) : []
  const bookmarksFor = (alwaysOn: boolean) => (['start', 'end'] as const)
    .map(position => formatBookmarkBlock(triggered.filter(bookmark => !!bookmark.alwaysOn === alwaysOn && bookmark.position === position)))
    .filter(Boolean).join('\n\n')
  const response = await fetch(`http://localhost:${process.env.PORT || 3000}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-lumbre-internal': process.env.LUMBRE_INTERNAL_SECRET || process.env.LUMBRE_AUTH_SECRET || process.env.LUMBRE_ACCESS_PASSWORD || '',
    },
    body: JSON.stringify({
      generation_route: route,
      cc_model: route === 'claude-code' ? ccModel : undefined,
      cc_effort: route === 'claude-code' ? resolved.ccEffort : undefined,
      cc_output_style: route === 'claude-code' ? resolved.ccOutputStyle : undefined,
      turn_id: route === 'claude-code' ? turnId : undefined,
      cc_require_resume: transport === 'stackchan' ? true : undefined,
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
      bookmark_injections: transport === 'stackchan' ? bookmarksFor(true) : bookmarkInjection(session, config, joinedText),
      client_volatile_context: [bookmarksFor(false), turnRules[transport]].filter(Boolean).join('\n\n'),
    }),
  })
  if (!response.ok) throw new Error(`${transportLabel}生成失败 (${response.status})`)

  const result: any = { content: '', thinking: '', tool_calls: [] }
  for await (const event of readChatEventStream(response)) {
    if (event.type === 'text') result.content += String(event.content || '')
    else if (event.type === 'thinking') result.thinking += String(event.content || '')
    else if (event.type === 'tool_call') result.tool_calls.push({ name: event.name, input: event.input, result: event.result })
    else if (event.type === 'error' || (transport === 'stackchan' && event.type === 'recoverable_disconnect')) {
      throw new Error(String(event.content || `${transportLabel}生成失败`))
    }
    else if (event.type === 'done') Object.assign(result, event)
  }
  const text = String(result.content || '').trim()
  if (!text) throw new Error(transport === 'wechat' ? '星星没有生成可发送的微信回复' : '星星没有生成可朗读的回复')
  appendSyncSessionMessage(sessionId, {
    id: assistantId,
    role: 'assistant',
    route,
    replyMode: 'short',
    content: text,
    timestamp: replyTimestamp,
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
    transport,
    transportBatchId: batchId,
  })
  return { text, batchId, duplicate: false }
}

export function runTransportTurn(transport: Transport, sessionId: string, batchId: string, parts: TransportTurnPart[]) {
  return enqueue(sessionId, () => generateTurn(transport, sessionId, batchId, parts))
}
