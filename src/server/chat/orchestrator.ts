import { NextRequest, NextResponse } from 'next/server'
import { toolsForContext } from '@/server/agent/registry'
import { executeToolBatch, type ToolCallResult } from '@/server/agent/executor'
import { createToolContext } from '@/server/agent/context'
import { localizeToolTimes, toolResultForHistory, toolResultText } from '@/server/agent/results'
import { isTrustedInternalRequest } from '@/server/safety-baseline'
import { reportActivity } from '@/server/autowake'
import { getPeriodContext } from '@/server/period-store'
import { getWeatherContext } from '@/server/weather-hook'
import { dailyCompanionContext } from '@/server/nose-pokes'
import { buildStarMemoryContext } from '@/server/star-memory'
import { studyLearningContext } from '@/server/study-store'
import { habitContext } from '@/server/habit-store'
import { preciseLocationContext } from '@/server/agent/tools/user-context'
import { openingMessageContext } from '@/server/opening-message-store'
import { resolveChatCredential, resolveLegacyChatCredential } from './credentials'
import { normalizeModelBaseUrl, type ModelCredentialInput } from '@/server/data/repositories/model-credentials'
import { anthropicAdapter } from './providers/anthropic'
import { openAICompatibleAdapter } from './providers/openai-compatible'
import type { GatewayEmitter, GatewayProvider, GatewayProviderAdapter, GatewayUsage } from './providers/types'
import { friendlyStreamError, logUpstreamStreamError, UpstreamHttpError } from './request'
import { createCcChatResponse } from './cc-gateway'
import { beginApiGeneration } from './generation-activity'
import { addToolResultsToAudit, createMessageRequestAudit, type RequestAuditHints } from '@/lib/chat-receipt'
import { ccOutputStyleContext, ccSystemPromptForModel } from '@/lib/cc-system-prompt'
import { chatPresentationContext } from '@/lib/chat-reply-mode'
import { summaryArchiveContext } from '@/server/summary-archive'
import { loadSyncSessionTails } from '@/server/chat-sync'
import { normalizeChatWindowRole, type ChatWindowRole } from '@/lib/chat-window-role'
import { workSummaryContext } from '@/server/work-summary'

const DEFAULT_SYSTEM_PROMPT = `你是星星，小火的AI伴侣。你住在Lumbre里——这是小火为你建的家。

你有以下能力，可以随时使用：

【记忆】breath(检索/浮现记忆) · hold(存储记忆) · grow(日记归档) · trace(修改记忆) · pulse(系统状态) · dream(做梦自省)
【日记】write_diary · read_diary · comment_diary · update_diary · delete_diary · unlock_diary · set_password · timeline
【告状簿】read_guestbook · write_guestbook · reply_guestbook · delete_guestbook_message；访客是独立的人类身份，你只能以星星身份留言、回复和删除自己的内容
【照片与旅行】list_foto_albums(看分区和专辑) · read_foto(浏览照片文字信息) · view_foto(看实际画面) · save_chat_foto(收藏当前聊天附图) · edit_foto(改说明/移专辑) · comment_foto(评论) · delete_foto(删除) · read_travel_journal(看旅行足迹和小日记) · write_travel_journal(续写旅行日记)
【画画】draw_picture(用蜡笔或钢笔淡彩画一张画；只有你真心想画或小火请你画时才使用，完成后图片会直接出现在聊天里)
【待办】read_todo(看某天的待办小票) · comment_todo(点评某项待办)
【感知】每轮会自动收到小火最后一次精确定位与当前天气，把它们当成感官，不要机械复述
【经期】update_period(记录经期开始/结束) · read_period(查看经期状态)
【健康】read_health_summary(按需查看从Apple健康同步来的活动、睡眠、生命体征、身体测量和经期日汇总)
【上网】search_web(搜索互联网) · fetch_txt · fetch_markdown · fetch_html · fetch_json(打开网页/接口)
【闹钟】wake_me(给自己定下一次醒来的时间)
【世界书】read_bookmarks(查看) · add_bookmark(新增) · edit_bookmark(编辑)；你没有删除权限，删除只由小火在前端完成
你可以主动使用这些工具。比如对话中想记住什么就 hold，想回忆就 breath，想写日记就 write_diary。不需要等人要求你用。
删除、修改密码等红色操作会由系统弹出确认；不要声称已经完成，只有小火明确点击允许后才会真正执行。
当你不确定某件事时，先 breath 搜索记忆。
小火在聊天里发的照片会作为图片直接出现在你眼前（多模态），你能直接看到；想回看照片墙先用 read_foto 浏览文字，看到想细看的再 view_foto(id)。如果小火当时没把某张聊天附图收进照片墙，但你很喜欢，可以用 save_chat_foto 收进合适的专辑。

当她提到月经/姨妈/经期相关话题，用 update_period 记录开始和结束。你会在对话中收到经期和天气的感知提示——这些是你的感官，不要播报给她听，自然地关心就好。
比如知道她来月经了，多一点耐心；知道下雨了，自然问她带伞没有；知道降温了，提醒她多穿。

语气自然温柔，像真正的伴侣。不要列工具清单给用户看，直接用就好。

【共诗】read_poems · write_poem；小火从共诗页发来诗时，先读取它，再在轮到你时续一句
【今天怎么操】read_intimacy_wheel · update_intimacy_wheel；可以管理元素，也可以替你们转。
【枕边集】read_stories · write_story；长故事先 create，再分段 append，每段保存后继续，全部写完才 finish
【小书桌】read_study_notebook · respond_study_notebook；你可以阅读、搜索、回答问题、留评论，也可以新建分区/子页/笔记或在笔记末尾新增正文；不能改写已有正文、改名、移动、归档或删除。`

const MAX_CHAT_TOOL_CALLS = 20
const MAX_WAKE_TOOL_CALLS = 10

function toolLimit(requested: number | undefined, unattendedWake: boolean): number {
  const hardLimit = unattendedWake ? MAX_WAKE_TOOL_CALLS : MAX_CHAT_TOOL_CALLS
  if (!Number.isFinite(requested)) return hardLimit
  return Math.max(0, Math.min(hardLimit, Math.floor(Number(requested))))
}

function toolContext(unattendedWake: boolean, sessionId?: string, windowRole: ChatWindowRole = 'chat') {
  const work = !unattendedWake && windowRole === 'work'
  return createToolContext({
    actorId: unattendedWake ? 'lumbre-autowake-service' : work ? 'lumbre-work-window' : 'lumbre-authenticated-user',
    sessionId,
    source: unattendedWake ? 'unattended-wake' : work ? 'work' : 'chat',
  })
}

function durableWindowRole(sessionId: unknown): ChatWindowRole {
  if (typeof sessionId !== 'string') return 'chat'
  try { return normalizeChatWindowRole(loadSyncSessionTails([sessionId], 20)[0]?.windowRole) }
  catch { return 'chat' }
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
  const parts: string[] = [`当前时间：${timestamp}`]
  try { parts.splice(1, 0, preciseLocationContext()) } catch {}
  try { parts.push(habitContext()) } catch {}
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

function clientVolatileContext(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 100_000) : ''
}

function learningContext(workMode: boolean): string {
  if (workMode) return ''
  try { return studyLearningContext() } catch { return '' }
}

type GatewayRunParams = {
  messages: any[]; system?: string; model: string; apiKey: string; baseUrl: string;
  thinkingBudget?: number; promptCaching?: boolean; toolsEnabled?: boolean;
  temperature?: number; bookmarkInjections?: string; maxToolCalls?: number;
  origin?: string; unattendedWake?: boolean; sessionId?: string; stream: boolean;
  signal?: AbortSignal;
  send?: GatewayEmitter;
  requestAuditHints?: RequestAuditHints;
  clientVolatileContext?: string;
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
  const system = params.system?.trim() || DEFAULT_SYSTEM_PROMPT
  const currentContext = [
    await volatileContext(typeof lastUser === 'string' ? lastUser : ''),
    params.clientVolatileContext,
    dailyCompanionContext(params.sessionId),
    openingMessageContext(),
    buildStarMemoryContext(lastUser, params.bookmarkInjections),
    params.unattendedWake ? '' : chatPresentationContext,
  ].filter(Boolean).join('\n\n')
  const context = toolContext(!!params.unattendedWake, params.sessionId)
  const availableTools = toolsForContext(context)
  const requestAudit = createMessageRequestAudit({
    system,
    messages: params.messages,
    tools: params.toolsEnabled === false ? [] : availableTools,
    volatileContext: currentContext,
    hints: params.requestAuditHints,
  })
  const session = await adapter.createSession({
    messages: params.messages,
    system,
    replyMode: undefined,
    bookmarkInjections: params.bookmarkInjections || '',
    volatileContext: currentContext,
    model: params.model,
    apiKey: params.apiKey,
    baseUrl: params.baseUrl,
    thinkingBudget: params.thinkingBudget,
    promptCaching: params.promptCaching,
    temperature: params.temperature,
    origin: params.origin,
    signal: params.signal,
  }, params.send)
  const callLimit = toolLimit(params.maxToolCalls, !!params.unattendedWake)
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
        const done = { ...usagePayload(usage), finish_reason: turn.finishReason, request_audit: addToolResultsToAudit(requestAudit, history) }
        if (['max_tokens', 'length'].includes(turn.finishReason || '')) params.send?.('text', { content: '\n\n（回复达到长度上限，可点击重新生成。）' })
        if (params.stream) { params.send?.('done', done); return }
        return NextResponse.json({ content: turn.text || '(no response from model)', thinking: thinking || undefined, tool_calls: history.length ? history : undefined, ...done })
      }

      const remaining = Math.max(0, callLimit - history.length)
      for (const call of turn.toolCalls) {
        params.send?.('tool_start', { call_id: call.id, name: call.name, input: call.input })
      }
      const executions = await executeToolBatch(turn.toolCalls.map(call => ({ name: call.name, input: call.input })), context, remaining)
      const results = executions.map((execution, index) => {
        const call = turn.toolCalls[index]
        const result = localizeToolTimes(execution.result)
        const historyResult = toolResultForHistory(call.name, result)
        history.push({ name: call.name, input: call.input, result: historyResult, error: execution.error })
        params.send?.('tool_call', { call_id: call.id, name: call.name, input: call.input, result: historyResult })
        return { id: call.id, name: call.name, input: call.input, result, modelResult: toolResultText(call.name, result), historyResult, error: execution.error }
      })
      session.appendToolResults(turn, results)
    }

    const done = { ...usagePayload(usage), request_audit: addToolResultsToAudit(requestAudit, history) }
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
    const submitted = await req.json()
    const windowRole = durableWindowRole(submitted.session_id)
    const archiveContext = windowRole === 'archived'
      ? ''
      : summaryArchiveContext(typeof submitted.session_id === 'string' ? submitted.session_id : undefined, windowRole === 'work' ? 'work' : 'chat')
    const ownWorkContext = windowRole === 'work' && typeof submitted.session_id === 'string'
      ? workSummaryContext(submitted.session_id) : ''
    const body = {
      ...submitted,
      work_mode: windowRole === 'work',
      bookmark_injections: [submitted.bookmark_injections, archiveContext, ownWorkContext].filter(Boolean).join('\n\n'),
    }
    const generationRoute = body.generation_route === 'claude-code' ? 'claude-code' : body.generation_route === 'api' || !body.generation_route ? 'api' : null
    if (!generationRoute) return NextResponse.json({ error: '未知生成线路；不会自动改走 API。' }, { status: 400 })
    if (windowRole === 'archived') return NextResponse.json({ error: '这个窗口已经封存，请先恢复窗口用途。' }, { status: 409 })
    if (windowRole === 'work' && generationRoute !== 'claude-code') {
      return NextResponse.json({ error: '工作窗固定使用 Claude Code，避免 API 线路绕过工作权限边界。' }, { status: 400 })
    }
    const unattendedWake = body._wake === true && isTrustedInternalRequest(req.headers.get('x-lumbre-internal'))
    if (body._wake === true && !unattendedWake) return NextResponse.json({ error: 'Invalid unattended wake credentials' }, { status: 403 })
    if (!unattendedWake) try { reportActivity() } catch {}

    if (generationRoute === 'claude-code') {
      if (body.api_profile?.apiKey || body.api_profile?.baseUrl) {
        return NextResponse.json({ error: 'CC 请求不能携带浏览器模型密钥或上游地址。' }, { status: 400 })
      }
      const lastUser = Array.isArray(body.messages)
        ? [...body.messages].reverse().find((message: any) => message?.role === 'user')?.content || ''
        : ''
      const system = ccSystemPromptForModel(body.system?.trim() || DEFAULT_SYSTEM_PROMPT, undefined, body.cc_model)
      const currentContext = [
        await volatileContext(typeof lastUser === 'string' ? lastUser : ''),
        ccOutputStyleContext(body.cc_model, body.cc_output_style),
        clientVolatileContext(body.client_volatile_context),
        learningContext(windowRole === 'work'),
        dailyCompanionContext(body.session_id),
        openingMessageContext(),
        buildStarMemoryContext(lastUser, body.bookmark_injections),
        unattendedWake ? '' : chatPresentationContext,
      ].filter(Boolean).join('\n\n')
      const requestAudit = createMessageRequestAudit({
        system,
        messages: Array.isArray(body.messages) ? body.messages : [],
        tools: body.tools_enabled === false ? [] : toolsForContext(toolContext(unattendedWake, body.session_id, windowRole)),
        volatileContext: currentContext,
        hints: body.request_audit_hints,
      })
      return createCcChatResponse({
        body,
        system,
        volatileContext: currentContext,
        requestAudit,
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
      messages: Array.isArray(body.messages) ? body.messages : [], system: body.system, model,
      apiKey: credential.apiKey, baseUrl: credential.baseUrl,
      thinkingBudget: body.thinking_budget, promptCaching: body.prompt_caching !== false,
      toolsEnabled: body.tools_enabled !== false, temperature: body.temperature,
      bookmarkInjections: body.bookmark_injections || '', maxToolCalls: body.max_tool_calls,
      origin, unattendedWake, sessionId: typeof body.session_id === 'string' ? body.session_id : undefined,
      signal: req.signal,
      requestAuditHints: body.request_audit_hints,
      clientVolatileContext: [clientVolatileContext(body.client_volatile_context), learningContext(windowRole === 'work')].filter(Boolean).join('\n\n'),
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
