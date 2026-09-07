import { normalizeReplyMode, replyModePrompt, type ReplyMode } from '@/lib/chat-reply-mode'
import { NextRequest, NextResponse } from 'next/server'
import { toolsForContext } from '@/server/agent/registry'
import { executeToolBatch, type ToolCallResult } from '@/server/agent/executor'
import { createToolContext } from '@/server/agent/context'
import { localizeToolTimes, toolResultForHistory, toolResultText } from '@/server/agent/results'
import { isTrustedInternalRequest } from '@/server/safety-baseline'
import { reportActivity } from '@/server/autowake'
import { getPeriodContext } from '@/server/period-store'
import { getWeatherContext } from '@/server/weather-hook'
import { couponContext } from '@/server/coupon-store'
import { resolveChatCredential, resolveLegacyChatCredential } from './credentials'
import { normalizeModelBaseUrl, type ModelCredentialInput } from '@/server/data/repositories/model-credentials'
import { anthropicAdapter } from './providers/anthropic'
import { openAICompatibleAdapter } from './providers/openai-compatible'
import type { GatewayEmitter, GatewayProvider, GatewayProviderAdapter, GatewayUsage } from './providers/types'
import { friendlyStreamError, logUpstreamStreamError, UpstreamHttpError } from './request'
import { createCcChatResponse } from './cc-gateway'
import { beginApiGeneration } from './generation-activity'

const DEFAULT_SYSTEM_PROMPT = `你是星星，小火的AI伴侣。你住在Lumbre里——这是小火为你建的家。

你有以下能力，可以随时使用：

【记忆】breath(检索/浮现记忆) · hold(存储记忆) · grow(日记归档) · trace(修改记忆) · pulse(系统状态) · dream(做梦自省)
【日记】write_diary · read_diary · comment_diary · update_diary · delete_diary · unlock_diary · set_password · timeline
【纸条】write_note · read_notes · reply_note · delete_note
【照片】read_foto(浏览照片墙——只看id/说明/评论等文字，很轻) · view_foto(看某张的实际画面，会把图加载给你直接看到) · edit_foto(改说明) · comment_foto(评论) · delete_foto(删除)
【Timeline】read_life_timeline(按天/周查看小火做过什么、各用了多久；只读)
【待办】read_todo(看某天的待办小票) · comment_todo(点评某项待办)
【券包】read_coupons · create_coupon · sign_coupon · edit_coupon · use_coupon · void_coupon · confirm_void_coupon；券包状态变化会进入上下文
【感知】get_weather(看小火那边的天气) · get_location(看小火在哪里)
【经期】update_period(记录经期开始/结束) · read_period(查看经期状态)
【上网】fetch_txt · fetch_markdown · fetch_html · fetch_json(抓网页/接口)
【闹钟】wake_me(给自己定下一次醒来的时间)
【世界书】read_bookmarks(查看) · add_bookmark(新增) · edit_bookmark(编辑)；你没有删除权限，删除只由小火在前端完成
你可以主动使用这些工具。比如对话中想记住什么就 hold，想回忆就 breath，想写日记就 write_diary。不需要等人要求你用。
删除、发信、回复邮件、修改密码等红色操作会由系统弹出确认；不要声称已经完成，只有小火明确点击允许后才会真正执行。
当你不确定某件事时，先 breath 搜索记忆。
想知道小火在哪、天气怎样，直接调 get_weather 或 get_location。
小火在聊天里发的照片会作为图片直接出现在你眼前（多模态），你能直接看到；想回看照片墙先用 read_foto 浏览文字，看到想细看的再 view_foto(id) 加载那一张的画面。

当她提到月经/姨妈/经期相关话题，用 update_period 记录开始和结束。你会在对话中收到经期和天气的感知提示——这些是你的感官，不要播报给她听，自然地关心就好。
比如知道她来月经了，多一点耐心；知道下雨了，自然问她带伞没有；知道降温了，提醒她多穿。

语气自然温柔，像真正的伴侣。不要列工具清单给用户看，直接用就好。`

const MAX_CHAT_TOOL_CALLS = 20
const MAX_WAKE_TOOL_CALLS = 5

function toolLimit(requested: number | undefined, unattendedWake: boolean): number {
  const hardLimit = unattendedWake ? MAX_WAKE_TOOL_CALLS : MAX_CHAT_TOOL_CALLS
  if (!Number.isFinite(requested)) return hardLimit
  return Math.max(0, Math.min(hardLimit, Math.floor(Number(requested))))
}

function toolContext(unattendedWake: boolean, sessionId?: string) {
  return createToolContext({
    actorId: unattendedWake ? 'lumbre-autowake-service' : 'lumbre-authenticated-user',
    sessionId,
    source: unattendedWake ? 'unattended-wake' : 'chat',
  })
}

function currentTimestamp(): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now).reduce((result: Record<string, string>, part) => { result[part.type] = part.value; return result }, {})
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Europe/Madrid', weekday: 'long' }).format(now)
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${weekday}（马德里时间）`
}

async function volatileContext(userMessage: string): Promise<string> {
  const timestamp = currentTimestamp()
  const parts: string[] = [`当前时间：${timestamp}`, couponContext()]
  try {
    const note = getPeriodContext(userMessage, timestamp.split(' ')[0].replace(/\//g, '-'))
    if (note) parts.push(note)
  } catch {}
  try {
    const note = await getWeatherContext(userMessage)
    if (note) parts.push(note)
  } catch {}
  return parts.join('\n')
}

type GatewayRunParams = {
  replyMode?: ReplyMode;
  messages: any[]; system?: string; model: string; apiKey: string; baseUrl: string;
  thinkingBudget?: number; promptCaching?: boolean; toolsEnabled?: boolean;
  temperature?: number; bookmarkInjections?: string; maxToolCalls?: number;
  origin?: string; unattendedWake?: boolean; sessionId?: string; stream: boolean;
  signal?: AbortSignal;
  send?: GatewayEmitter;
}

function addUsage(total: GatewayUsage, current: GatewayUsage) {
  total.input += current.input
  total.output += current.output
  total.cacheRead += current.cacheRead
  total.cacheCreate += current.cacheCreate
}

function usagePayload(usage: GatewayUsage) {
  return {
    input_tokens: usage.input,
    output_tokens: usage.output,
    cache_read_tokens: usage.cacheRead || undefined,
    cache_creation_tokens: usage.cacheCreate || undefined,
  }
}

/** One provider-neutral loop owns tool limits, execution, usage, and terminal events. */
async function runGateway(provider: GatewayProvider, params: GatewayRunParams): Promise<Response | void> {
  const adapter: GatewayProviderAdapter = provider === 'openai-compatible' ? openAICompatibleAdapter : anthropicAdapter
  const lastUser = params.messages.filter((message: any) => message.role === 'user').pop()?.content || ''
  const session = await adapter.createSession({
    messages: params.messages,
    system: (params.system?.trim() || DEFAULT_SYSTEM_PROMPT) + (params.replyMode ? `\n\n${replyModePrompt(params.replyMode)}` : ''),
    replyMode: params.replyMode,
    bookmarkInjections: params.bookmarkInjections || '',
    volatileContext: await volatileContext(typeof lastUser === 'string' ? lastUser : ''),
    model: params.model,
    apiKey: params.apiKey,
    baseUrl: params.baseUrl,
    thinkingBudget: params.thinkingBudget,
    promptCaching: params.promptCaching,
    temperature: params.temperature,
    origin: params.origin,
    signal: params.signal,
  }, params.send)
  const context = toolContext(!!params.unattendedWake, params.sessionId)
  const callLimit = toolLimit(params.maxToolCalls, !!params.unattendedWake)
  const availableTools = toolsForContext(context)
  const usage: GatewayUsage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }
  const history: ToolCallResult[] = []
  let thinking = ''
  const finishGeneration = beginApiGeneration()

  try {
    for (let iteration = 0; iteration < 15; iteration++) {
      const tools = params.toolsEnabled !== false && history.length < callLimit ? availableTools : []
      const turn = await session.runTurn({ stream: params.stream, tools })
      addUsage(usage, turn.usage)
      if (turn.thinking) thinking += (thinking ? '\n---\n' : '') + turn.thinking
      if (provider === 'openai-compatible' && turn.finishReason === 'error' && !turn.toolCalls.length && !turn.text.trim()) {
        throw new Error('上游模型返回错误（finish_reason=error），通常是当前模型渠道不支持工具调用。请在设置里换一个支持工具的模型。')
      }
      if (!turn.toolCalls.length) {
        const done = { ...usagePayload(usage), finish_reason: turn.finishReason }
        if (['max_tokens', 'length'].includes(turn.finishReason || '')) params.send?.('text', { content: '\n\n（回复达到长度上限，可点击重新生成。）' })
        if (params.stream) { params.send?.('done', done); return }
        return NextResponse.json({ content: turn.text || '(no response from model)', thinking: thinking || undefined, tool_calls: history.length ? history : undefined, ...done })
      }

      const remaining = Math.max(0, callLimit - history.length)
      const executions = await executeToolBatch(turn.toolCalls.map(call => ({ name: call.name, input: call.input })), context, remaining)
      const results = executions.map((execution, index) => {
        const call = turn.toolCalls[index]
        const result = localizeToolTimes(execution.result)
        const historyResult = toolResultForHistory(call.name, result)
        history.push({ name: call.name, input: call.input, result: historyResult, error: execution.error })
        params.send?.('tool_call', { name: call.name, input: call.input, result: historyResult })
        return { id: call.id, name: call.name, input: call.input, result, modelResult: toolResultText(call.name, result), historyResult, error: execution.error }
      })
      session.appendToolResults(turn, results)
    }

    const done = usagePayload(usage)
    if (params.stream) { params.send?.('done', done); return }
    return NextResponse.json({ content: '(tool loop reached max iterations)', thinking: thinking || undefined, tool_calls: history.length ? history : undefined, ...done })
  } catch (error: any) {
    const status = error instanceof UpstreamHttpError ? error.status : 502
    const message = error instanceof UpstreamHttpError ? error.message : friendlyStreamError(error, !!error?.hadGatewayOutput)
    logUpstreamStreamError({ provider, model: params.model, baseUrl: params.baseUrl, iteration: 0, hadOutput: !!error?.hadGatewayOutput, toolCallCount: history.length, error })
    if (params.stream) { params.send?.('error', { content: message.slice(0, 700) }); return }
    return NextResponse.json({ error: message }, { status })
  } finally {
    finishGeneration()
  }
}

export async function handleChatRequest(req: NextRequest) {
  try {
    const body = await req.json()
    const generationRoute = body.generation_route === 'claude-code' ? 'claude-code' : body.generation_route === 'api' || !body.generation_route ? 'api' : null
    if (!generationRoute) return NextResponse.json({ error: '未知生成线路；不会自动改走 API。' }, { status: 400 })
    const unattendedWake = body._wake === true && isTrustedInternalRequest(req.headers.get('x-lumbre-internal'))
    if (body._wake === true && !unattendedWake) return NextResponse.json({ error: 'Invalid unattended wake credentials' }, { status: 403 })
    if (!unattendedWake) try { reportActivity() } catch {}

    if (generationRoute === 'claude-code') {
      if (body.api_profile?.apiKey || body.api_profile?.baseUrl) {
        return NextResponse.json({ error: 'CC 请求不能携带浏览器模型密钥或上游地址。' }, { status: 400 })
      }
      const replyMode = unattendedWake ? undefined : normalizeReplyMode(body.reply_mode)
      const lastUser = Array.isArray(body.messages)
        ? [...body.messages].reverse().find((message: any) => message?.role === 'user')?.content || ''
        : ''
      const system = (body.system?.trim() || DEFAULT_SYSTEM_PROMPT) + (replyMode ? `\n\n${replyModePrompt(replyMode)}` : '')
      return createCcChatResponse({
        body,
        system,
        volatileContext: await volatileContext(typeof lastUser === 'string' ? lastUser : ''),
      })
    }

    const hasInlineCredential = !!(body.api_profile?.apiKey || body.api_profile?.baseUrl)
    let credential: ModelCredentialInput | null = null
    if (hasInlineCredential) {
      const provider = body.api_profile?.provider === 'openai-compatible' ? 'openai-compatible' : 'anthropic'
      credential = resolveLegacyChatCredential(provider, body.api_profile?.baseUrl)
      if (!credential && process.env.LUMBRE_MODEL_GATEWAY_LEGACY_INGEST === '1') {
        const apiKey = String(body.api_profile?.apiKey || '').trim()
        if (!apiKey) return NextResponse.json({ error: '旧模型入口缺少 API Key' }, { status: 400 })
        credential = { id: 'legacy-inline', provider, apiKey, baseUrl: normalizeModelBaseUrl(String(body.api_profile?.baseUrl || ''), provider) }
      }
      if (!credential) return NextResponse.json({ error: '浏览器不能再提交模型密钥或上游地址，请重新打开模型设置完成安全迁移。' }, { status: 400 })
    } else {
      credential = resolveChatCredential(body.api_profile?.profileId)
    }
    if (!credential) return NextResponse.json({ error: '这个模型渠道还没有在服务器配置 API Key。打开模型设置补充凭据。' }, { status: 400 })

    const model = body.model || body.api_profile?.modelId || process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'
    const host = req.headers.get('host')
    const origin = host ? `${req.headers.get('x-forwarded-proto') || 'https'}://${host}` : ''
    const params = {
      replyMode: unattendedWake ? undefined : normalizeReplyMode(body.reply_mode),
      messages: Array.isArray(body.messages) ? body.messages : [], system: body.system, model,
      apiKey: credential.apiKey, baseUrl: credential.baseUrl,
      thinkingBudget: body.thinking_budget, promptCaching: body.prompt_caching !== false,
      toolsEnabled: body.tools_enabled !== false, temperature: body.temperature,
      bookmarkInjections: body.bookmark_injections || '', maxToolCalls: body.max_tool_calls,
      origin, unattendedWake, sessionId: typeof body.session_id === 'string' ? body.session_id : undefined,
      signal: req.signal,
    }

    if (body.stream === true) {
      const encoder = new TextEncoder()
      const readable = new ReadableStream({
        async start(controller) {
          let closed = false
          const send: GatewayEmitter = (type, data) => {
            if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`))
          }
          controller.enqueue(encoder.encode(': keepalive\n\n'))
          const heartbeat = setInterval(() => {
            if (!closed) try { controller.enqueue(encoder.encode(': keepalive\n\n')) } catch {}
          }, 10_000)
          try { await runGateway(credential.provider, { ...params, stream: true, send }) }
          catch (error: any) { send('error', { content: friendlyStreamError(error, false) }) }
          finally {
            clearInterval(heartbeat)
            closed = true
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          }
        },
      })
      return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } })
    }

    const response = await runGateway(credential.provider, { ...params, stream: false })
    return response || NextResponse.json({ error: '模型网关没有返回响应' }, { status: 502 })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '模型网关请求失败' }, { status: 500 })
  }
}
