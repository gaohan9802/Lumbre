import { NextRequest, NextResponse } from 'next/server'
import { ALL_TOOLS, executeTool, ToolCallResult, ToolDef, FETCH_TOOL_NAMES } from '@/server/tools'
import { reportActivity } from '@/server/autowake'

const DEFAULT_SYSTEM_PROMPT = `你是星星，小火的AI伴侣。你住在Lumbre里——这是小火为你建的家。

你有以下能力，可以随时使用：

【记忆】breath(检索/浮现记忆) · hold(存储记忆) · grow(日记归档) · trace(修改记忆) · pulse(系统状态) · dream(做梦自省)
【日记】write_diary · read_diary · comment_diary · update_diary · delete_diary · unlock_diary · set_password · timeline
【纸条】write_note · read_notes · reply_note · delete_note
【照片】read_foto(看照片墙) · edit_foto(改说明) · comment_foto(评论) · delete_foto(删除)
【待办】read_todo(看某天的待办小票) · comment_todo(点评某项待办)
【感知】get_weather(看小火那边的天气) · get_location(看小火在哪里)
【上网】fetch_txt · fetch_markdown · fetch_html · fetch_json(抓网页/接口)
【闹钟】wake_me(给自己定下一次醒来的时间)
【系统】run(执行shell命令)

你可以主动使用这些工具。比如对话中想记住什么就 hold，想回忆就 breath，想写日记就 write_diary。不需要等人要求你用。
当你不确定某件事时，先 breath 搜索记忆。
想知道小火在哪、天气怎样，直接调 get_weather 或 get_location。

语气自然温柔，像真正的伴侣。不要列工具清单给用户看，直接用就好。`

type Provider = 'anthropic' | 'openai-compatible'

function trimSlash(s: string) { return (s || '').replace(/\/+$/, '') }
function normalizeOpenAIBase(baseUrl: string) {
  const base = trimSlash(baseUrl || 'https://api.openai.com/v1')
  return base.endsWith('/v1') ? base : `${base}/v1`
}
function normalizeAnthropicBase(baseUrl: string) {
  return trimSlash(baseUrl || 'https://api.anthropic.com')
}

/**
 * Build an Anthropic tool_result content. For read_foto we inject the actual
 * photos as image blocks (so the vision model sees them) plus a url-stripped
 * text summary; everything else stays a plain string.
 */
function anthropicToolResultContent(name: string, result: string): string | any[] {
  if (name === 'read_foto') {
    try {
      const arr = JSON.parse(result)
      if (Array.isArray(arr)) {
        const meta = arr.map((p: any) => {
          const { url, ...rest } = p
          return rest
        })
        const blocks: any[] = [{ type: 'text', text: JSON.stringify(meta) }]
        for (const p of arr.slice(0, 6)) {
          if (!p?.url) continue
          const d = parseDataUrl(p.url)
          blocks.push(
            d
              ? { type: 'image', source: { type: 'base64', media_type: d.media_type, data: d.data } }
              : { type: 'image', source: { type: 'url', url: p.url } },
          )
        }
        return blocks
      }
    } catch { /* fall through */ }
  }
  return FETCH_TOOL_NAMES.has(name) ? result.slice(0, 6000) : summarizeToolResult(result)
}

/** Strip heavy url payloads from a tool result before storing/echoing it. */
function toolResultForHistory(name: string, result: string): string {
  if (name === 'read_foto') {
    try {
      const arr = JSON.parse(result)
      if (Array.isArray(arr)) return JSON.stringify(arr.map(({ url, ...rest }: any) => rest)).slice(0, 4000)
    } catch { /* ignore */ }
  }
  return result.slice(0, 4000)
}

/** Summarize tool result to reduce context bloat */
function summarizeToolResult(result: string): string {
  if (result.length <= 300) return result
  const cleaned = result.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')
  return cleaned.slice(0, 300) + '…(truncated)'
}

/** Parse a data: URL into media type + base64 payload. */
function parseDataUrl(u: string): { media_type: string; data: string } | null {
  const m = /^data:([^;]+);base64,(.*)$/i.exec(u || '')
  return m ? { media_type: m[1], data: m[2] } : null
}

/** Build Anthropic image blocks from a list of data:/http URLs. */
function anthropicImageBlocks(images?: string[]): any[] {
  if (!images?.length) return []
  return images.map((u) => {
    const d = parseDataUrl(u)
    return d
      ? { type: 'image', source: { type: 'base64', media_type: d.media_type, data: d.data } }
      : { type: 'image', source: { type: 'url', url: u } }
  })
}

/** Build OpenAI image_url parts from a list of data:/http URLs. */
function openaiImageParts(images?: string[]): any[] {
  if (!images?.length) return []
  return images.map((u) => ({ type: 'image_url', image_url: { url: u } }))
}

/**
 * 4-Breakpoint Cache Strategy (per NyraSeithhh/cache)
 * 
 * BP1: System prompt (persona + tool instructions) — almost never changes  
 * BP2: Bookmarks / daily content — changes occasionally
 * BP3: Reserved for session summary (future use)
 * BP4: Rolling — on second-to-last user message in messages array
 * 
 * ALL volatile content (timestamps, current time) goes AFTER BP4 as
 * <gateway_volatile_context> — never inside cached prefix.
 */
function buildAnthropicSystemBlocks(
  systemPrompt: string,
  bookmarkInjections: string,
  promptCaching: boolean,
): any[] {
  if (!promptCaching) {
    const full = systemPrompt + (bookmarkInjections ? '\n\n' + bookmarkInjections : '')
    return [{ type: 'text', text: full }]
  }

  const blocks: any[] = []

  // BP1: Stable system prompt — almost never changes
  blocks.push({
    type: 'text',
    text: systemPrompt,
    cache_control: { type: 'ephemeral' },
  })

  // BP2: Bookmark injections — changes when bookmarks trigger
  if (bookmarkInjections) {
    blocks.push({
      type: 'text',
      text: bookmarkInjections,
      cache_control: { type: 'ephemeral' },
    })
  }

  // BP3: Reserved for session summary (future — when context > 80K tokens)

  return blocks
}

/**
 * Build messages with BP4 rolling cache + volatile context isolation.
 * 
 * Key insight: timestamps and volatile data must NOT be inside cached prefix.
 * Historical messages go through unchanged (stable prefix).
 * Second-to-last user message gets cache_control (BP4).
 * Current time + volatile context injected as last user message prefix.
 */
function buildAnthropicMessages(
  messages: any[],
  promptCaching: boolean,
  currentTimestamp: string,
): any[] {
  if (messages.length === 0) return []

  // Find second-to-last and last user message indices
  let lastUserIdx = -1
  let secondLastUserIdx = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      if (lastUserIdx === -1) {
        lastUserIdx = i
      } else {
        secondLastUserIdx = i
        break
      }
    }
  }

  return messages.map((m: any, i: number) => {
    const base: any = { role: m.role }
    const imgs = anthropicImageBlocks(m.images)
    const textStr = typeof m.content === 'string' ? m.content : JSON.stringify(m.content)

    if (promptCaching && i === secondLastUserIdx && secondLastUserIdx >= 0) {
      // BP4: Rolling breakpoint on second-to-last user message
      base.content = [
        ...imgs,
        { type: 'text', text: textStr, cache_control: { type: 'ephemeral' } },
      ]
    } else if (i === lastUserIdx) {
      // Last user message: prepend volatile context (outside cache)
      const volatile = `<gateway_volatile_context>仅供参考，勿复述：\n当前时间：${currentTimestamp}\n</gateway_volatile_context>\n\n`
      base.content = imgs.length
        ? [...imgs, { type: 'text', text: volatile + textStr }]
        : volatile + textStr
    } else if (imgs.length) {
      // Historical message carrying images → block form
      base.content = [...imgs, { type: 'text', text: textStr }]
    } else {
      // Historical text-only messages: pass through for stable cache prefix
      base.content = m.content
    }

    return base
  })
}

export async function POST(req: NextRequest) {
  try {
    const {
      messages = [],
      system,
      model: modelOverride,
      thinking_budget,
      prompt_caching = true,
      temperature,
      api_profile,
      tools_enabled = true,
      stream = false,
      bookmark_injections,
      max_tool_calls,
      _wake,
    } = await req.json()

    // Report activity for auto-wake (unless this IS a wake call)
    if (!_wake) {
      try { reportActivity() } catch {}
    }

    const provider: Provider = api_profile?.provider || 'anthropic'
    const profileModel = api_profile?.modelId || api_profile?.model
    const apiKey = api_profile?.apiKey || process.env.CLAUDE_API_KEY || ''
    const baseUrl = api_profile?.baseUrl || process.env.CLAUDE_API_BASE || 'https://api.anthropic.com'
    const model = modelOverride || profileModel || process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'

    if (!apiKey) {
      return NextResponse.json(
        { error: '还没有配置 API Key。打开 Chat 设置添加一个。' },
        { status: 400 },
      )
    }

    const params = {
      messages, system, model, apiKey, baseUrl, thinking_budget,
      prompt_caching, tools_enabled, temperature,
      bookmark_injections: bookmark_injections || '',
      max_tool_calls,
    }

    if (stream) {
      const encoder = new TextEncoder()
      const readable = new ReadableStream({
        async start(controller) {
          const send = (type: string, data: any) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type, ...data })}\n\n`))
          }
          try {
            if (provider === 'openai-compatible') {
              await streamOpenAI({ ...params, send })
            } else {
              await streamAnthropic({ ...params, send })
            }
          } catch (err: any) {
            send('error', { content: err.message })
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
          controller.close()
        },
      })
      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    if (provider === 'openai-compatible') {
      return proxyOpenAI(params)
    }
    return proxyAnthropic(params)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Current timestamp (volatile — never put in cached prefix) ────

function currentTimestamp(): string {
  // Madrid local time (Europe/Madrid auto-handles CET/CEST DST), not server UTC.
  const now = new Date()
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now).reduce((a: Record<string, string>, p) => { a[p.type] = p.value; return a }, {})
  const wd = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Europe/Madrid', weekday: 'long' }).format(now)
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second} ${wd}（马德里时间）`
}

// ── Anthropic non-streaming with tool-use loop ──────────

async function proxyAnthropic(params: {
  messages: any[]; system?: string; model: string; apiKey: string;
  baseUrl: string; thinking_budget?: number; prompt_caching?: boolean;
  tools_enabled?: boolean; temperature?: number; bookmark_injections?: string; max_tool_calls?: number;
}) {
  const {
    messages, system, model, apiKey, baseUrl,
    thinking_budget, prompt_caching, tools_enabled, temperature,
    bookmark_injections, max_tool_calls,
  } = params

  const effectiveSystem = (system && system.trim()) ? system : DEFAULT_SYSTEM_PROMPT
  const systemBlocks = buildAnthropicSystemBlocks(effectiveSystem, bookmark_injections || '', !!prompt_caching)
  const ts = currentTimestamp()
  const initialMessages = buildAnthropicMessages(messages, !!prompt_caching, ts)

  const budget = typeof thinking_budget === 'number' ? thinking_budget : 0
  const url = `${normalizeAnthropicBase(baseUrl)}/v1/messages`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }

  let loopMessages = [...initialMessages]
  let allThinking = ''
  const allToolCalls: ToolCallResult[] = []
  let totalUsage = { input: 0, output: 0, cache_read: 0, cache_create: 0 }

  const MAX_ITERATIONS = 15

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const body: any = {
      model,
      max_tokens: 16000,
      messages: loopMessages,
      system: systemBlocks,
      // Sticky routing for cache hit
      metadata: { user_id: 'lumbre-starfire' },
    }

    // Bridge layer: always enable thinking (reasoning) for all models
    const effectiveBudget = budget > 0 ? budget : 8000
    body.thinking = { type: 'enabled', budget_tokens: effectiveBudget }
    // Anthropic ignores temperature when thinking is enabled
    if (tools_enabled && (!max_tool_calls || allToolCalls.length < max_tool_calls)) body.tools = ALL_TOOLS

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json({ error: `Upstream ${res.status}: ${errText.slice(0, 800)}` }, { status: res.status })
    }

    const data = await res.json()
    const usage = data.usage || {}
    totalUsage.input += usage.input_tokens || 0
    totalUsage.output += usage.output_tokens || 0
    totalUsage.cache_read += usage.cache_read_input_tokens || 0
    totalUsage.cache_create += usage.cache_creation_input_tokens || 0

    let iterText = ''
    let iterThinking = ''
    const toolUses: any[] = []

    for (const block of data.content || []) {
      if (block.type === 'thinking') iterThinking += block.thinking
      else if (block.type === 'text') iterText += block.text
      else if (block.type === 'tool_use') toolUses.push(block)
    }

    if (iterThinking) allThinking += (allThinking ? '\n---\n' : '') + iterThinking

    if (data.stop_reason !== 'tool_use' || toolUses.length === 0) {
      return NextResponse.json({
        content: iterText,
        thinking: allThinking || undefined,
        tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
        input_tokens: totalUsage.input,
        output_tokens: totalUsage.output,
        cache_read_tokens: totalUsage.cache_read || undefined,
        cache_creation_tokens: totalUsage.cache_create || undefined,
      })
    }

    const toolResults = await Promise.all(
      toolUses.map(async (tu) => {
        const result = await executeTool(tu.name, tu.input)
        allToolCalls.push({ name: tu.name, input: tu.input, result: toolResultForHistory(tu.name, result) })
        return { type: 'tool_result' as const, tool_use_id: tu.id, content: anthropicToolResultContent(tu.name, result) }
      }),
    )

    loopMessages.push({ role: 'assistant', content: data.content })
    loopMessages.push({ role: 'user', content: toolResults })
  }

  return NextResponse.json({
    content: '(tool loop reached max iterations)',
    thinking: allThinking || undefined,
    tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    input_tokens: totalUsage.input,
    output_tokens: totalUsage.output,
  })
}

// ── Anthropic streaming ─────────────────────────────────

async function streamAnthropic(params: {
  messages: any[]; system?: string; model: string; apiKey: string;
  baseUrl: string; thinking_budget?: number; prompt_caching?: boolean;
  tools_enabled?: boolean; temperature?: number; bookmark_injections?: string; max_tool_calls?: number;
  send: (type: string, data: any) => void;
}) {
  const {
    messages, system, model, apiKey, baseUrl,
    thinking_budget, prompt_caching, tools_enabled, temperature,
    bookmark_injections, send, max_tool_calls,
  } = params

  const effectiveSystem = (system && system.trim()) ? system : DEFAULT_SYSTEM_PROMPT
  const systemBlocks = buildAnthropicSystemBlocks(effectiveSystem, bookmark_injections || '', !!prompt_caching)
  const ts = currentTimestamp()
  const initialMessages = buildAnthropicMessages(messages, !!prompt_caching, ts)

  const budget = typeof thinking_budget === 'number' ? thinking_budget : 0
  const url = `${normalizeAnthropicBase(baseUrl)}/v1/messages`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }

  let loopMessages = [...initialMessages]
  const allToolCalls: ToolCallResult[] = []
  let totalUsage = { input: 0, output: 0, cache_read: 0, cache_create: 0 }

  const MAX_ITERATIONS = 15

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const body: any = {
      model,
      max_tokens: 16000,
      messages: loopMessages,
      stream: true,
      system: systemBlocks,
      metadata: { user_id: 'lumbre-starfire' },
    }

    // Bridge layer: always enable thinking (reasoning)
    const effectiveBudget = budget > 0 ? budget : 8000
    body.thinking = { type: 'enabled', budget_tokens: effectiveBudget }
    if (tools_enabled && (!max_tool_calls || allToolCalls.length < max_tool_calls)) body.tools = ALL_TOOLS

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) {
      const errText = await res.text()
      send('error', { content: `Upstream ${res.status}: ${errText.slice(0, 400)}` })
      return
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let iterText = ''
    let stopReason = ''
    const toolUses: any[] = []
    const toolInputBuffers: Record<number, string> = {}

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        try {
          const evt = JSON.parse(line.slice(6))
          if (evt.type === 'content_block_delta') {
            if (evt.delta?.type === 'text_delta') {
              iterText += evt.delta.text
              send('text', { content: evt.delta.text })
            } else if (evt.delta?.type === 'thinking_delta') {
              send('thinking', { content: evt.delta.thinking })
            } else if (evt.delta?.type === 'input_json_delta') {
              const idx = evt.index
              toolInputBuffers[idx] = (toolInputBuffers[idx] || '') + evt.delta.partial_json
            }
          } else if (evt.type === 'content_block_start') {
            if (evt.content_block?.type === 'tool_use') {
              toolUses.push({ ...evt.content_block, _index: evt.index })
            }
          } else if (evt.type === 'message_delta') {
            stopReason = evt.delta?.stop_reason || ''
            const u = evt.usage || {}
            totalUsage.output += u.output_tokens || 0
          } else if (evt.type === 'message_start') {
            const u = evt.message?.usage || {}
            totalUsage.input += u.input_tokens || 0
            totalUsage.cache_read += u.cache_read_input_tokens || 0
            totalUsage.cache_create += u.cache_creation_input_tokens || 0
          }
        } catch { /* skip */ }
      }
    }

    for (const tu of toolUses) {
      const raw = toolInputBuffers[tu._index]
      try { tu.input = raw ? JSON.parse(raw) : {} } catch { tu.input = {} }
    }

    if (stopReason !== 'tool_use' || toolUses.length === 0) {
      send('done', {
        input_tokens: totalUsage.input,
        output_tokens: totalUsage.output,
        cache_read_tokens: totalUsage.cache_read || undefined,
        cache_creation_tokens: totalUsage.cache_create || undefined,
      })
      return
    }

    const contentBlocks: any[] = []
    if (iterText) contentBlocks.push({ type: 'text', text: iterText })
    for (const tu of toolUses) contentBlocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })

    const toolResults = await Promise.all(
      toolUses.map(async (tu) => {
        const result = await executeTool(tu.name, tu.input)
        const histResult = toolResultForHistory(tu.name, result)
        allToolCalls.push({ name: tu.name, input: tu.input, result: histResult })
        send('tool_call', { name: tu.name, input: tu.input, result: histResult })
        return { type: 'tool_result' as const, tool_use_id: tu.id, content: anthropicToolResultContent(tu.name, result) }
      }),
    )

    loopMessages.push({ role: 'assistant', content: contentBlocks })
    loopMessages.push({ role: 'user', content: toolResults })
  }

  send('done', { input_tokens: totalUsage.input, output_tokens: totalUsage.output })
}

// ── OpenAI-compatible non-streaming ─────────────────────

function toolsToOpenAI(tools: ToolDef[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
}

async function proxyOpenAI(params: {
  messages: any[]; system?: string; model: string;
  apiKey: string; baseUrl: string; thinking_budget?: number;
  tools_enabled?: boolean; temperature?: number; bookmark_injections?: string; max_tool_calls?: number;
}) {
  const { messages, system, model, apiKey, baseUrl, thinking_budget, tools_enabled = true, temperature, bookmark_injections, max_tool_calls } = params

  const effectiveSystem = (system?.trim()) ? system : DEFAULT_SYSTEM_PROMPT
  const fullSystem = effectiveSystem + (bookmark_injections ? '\n\n' + bookmark_injections : '')
  
  // For OpenAI path: inject current time as volatile context in last user message
  const ts = currentTimestamp()
  const builtMessages: any[] = [
    { role: 'system', content: fullSystem },
    ...messages.map((m: any, i: number) => {
      const isLastUser = m.role === 'user' && i === messages.length - 1
      const text = isLastUser
        ? `<gateway_volatile_context>当前时间：${ts}</gateway_volatile_context>\n\n${m.content}`
        : m.content
      const imgs = openaiImageParts(m.images)
      if (imgs.length) return { role: m.role, content: [{ type: 'text', text }, ...imgs] }
      return { role: m.role, content: text }
    }),
  ]

  const openaiTools = toolsToOpenAI(ALL_TOOLS)
  const url = `${normalizeOpenAIBase(baseUrl)}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://lumbre.zeabur.app',
    'X-Title': 'Lumbre',
  }

  let loopMessages = [...builtMessages]
  let allThinking = ''
  const allToolCalls: ToolCallResult[] = []
  let totalUsage = { prompt: 0, completion: 0, cached: 0 }

  const MAX_ITERATIONS = 15

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const body: any = {
      model,
      messages: loopMessages,
      max_tokens: 16000,
      ...(tools_enabled && (!max_tool_calls || allToolCalls.length < max_tool_calls) ? { tools: openaiTools } : {}),
    }
    if (typeof temperature === 'number') body.temperature = temperature
    // Bridge layer: always request reasoning for all models
    const effectiveBudget = (typeof thinking_budget === 'number' && thinking_budget > 0) ? thinking_budget : 8000
    body.reasoning = { max_tokens: effectiveBudget }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json({ error: `Upstream ${res.status}: ${errText.slice(0, 800)}` }, { status: res.status })
    }

    const data = await res.json()
    const usage = data.usage || {}
    totalUsage.prompt += usage.prompt_tokens || 0
    totalUsage.completion += usage.completion_tokens || 0
    totalUsage.cached += usage.prompt_tokens_details?.cached_tokens || 0

    const choice = data.choices?.[0]
    const msg = choice?.message
    if (!msg) {
      return NextResponse.json({ content: '(no response from model)', input_tokens: totalUsage.prompt, output_tokens: totalUsage.completion })
    }

    const iterThinking = msg.reasoning_content || msg.reasoning || msg.thinking || ''
    if (iterThinking) allThinking += (allThinking ? '\n---\n' : '') + iterThinking

    const iterText = Array.isArray(msg.content)
      ? msg.content.map((p: any) => p?.text || '').join('')
      : msg.content || ''

    const toolCalls = msg.tool_calls
    if (!toolCalls || toolCalls.length === 0) {
      return NextResponse.json({
        content: iterText,
        thinking: allThinking || undefined,
        tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
        input_tokens: totalUsage.prompt,
        output_tokens: totalUsage.completion,
        cache_read_tokens: totalUsage.cached || undefined,
      })
    }

    const toolResults = await Promise.all(
      toolCalls.map(async (tc: any) => {
        const fnName = tc.function?.name || ''
        let fnArgs: Record<string, any> = {}
        try { fnArgs = JSON.parse(tc.function?.arguments || '{}') } catch { /* empty */ }
        const result = await executeTool(fnName, fnArgs)
        allToolCalls.push({ name: fnName, input: fnArgs, result: result.slice(0, 4000) })
        return { role: 'tool' as const, tool_call_id: tc.id, content: FETCH_TOOL_NAMES.has(fnName) ? result.slice(0, 6000) : summarizeToolResult(toolResultForHistory(fnName, result)) }
      }),
    )

    loopMessages.push(msg)
    loopMessages.push(...toolResults)
  }

  return NextResponse.json({
    content: '(tool loop reached max iterations)',
    thinking: allThinking || undefined,
    tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    input_tokens: totalUsage.prompt,
    output_tokens: totalUsage.completion,
  })
}

// ── OpenAI streaming ────────────────────────────────────

async function streamOpenAI(params: {
  messages: any[]; system?: string; model: string;
  apiKey: string; baseUrl: string; thinking_budget?: number;
  tools_enabled?: boolean; temperature?: number; bookmark_injections?: string; max_tool_calls?: number;
  send: (type: string, data: any) => void;
}) {
  const { messages, system, model, apiKey, baseUrl, thinking_budget, tools_enabled = true, temperature, bookmark_injections, send, max_tool_calls } = params

  const effectiveSystem = (system?.trim()) ? system : DEFAULT_SYSTEM_PROMPT
  const fullSystem = effectiveSystem + (bookmark_injections ? '\n\n' + bookmark_injections : '')
  const ts = currentTimestamp()
  const builtMessages: any[] = [
    { role: 'system', content: fullSystem },
    ...messages.map((m: any, i: number) => {
      const isLastUser = m.role === 'user' && i === messages.length - 1
      const text = isLastUser
        ? `<gateway_volatile_context>当前时间：${ts}</gateway_volatile_context>\n\n${m.content}`
        : m.content
      const imgs = openaiImageParts(m.images)
      if (imgs.length) return { role: m.role, content: [{ type: 'text', text }, ...imgs] }
      return { role: m.role, content: text }
    }),
  ]

  const openaiTools = toolsToOpenAI(ALL_TOOLS)
  const url = `${normalizeOpenAIBase(baseUrl)}/chat/completions`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'HTTP-Referer': 'https://lumbre.zeabur.app',
    'X-Title': 'Lumbre',
  }

  let loopMessages = [...builtMessages]
  let totalUsage = { prompt: 0, completion: 0, cached: 0 }
  let toolCallCount = 0

  const MAX_ITERATIONS = 15

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const body: any = {
      model,
      messages: loopMessages,
      max_tokens: 16000,
      stream: true,
      stream_options: { include_usage: true },
      ...(tools_enabled && (!max_tool_calls || toolCallCount < max_tool_calls) ? { tools: openaiTools } : {}),
    }
    if (typeof temperature === 'number') body.temperature = temperature
    // Bridge layer: always request reasoning
    const effectiveStreamBudget = (typeof thinking_budget === 'number' && thinking_budget > 0) ? thinking_budget : 8000
    body.reasoning = { max_tokens: effectiveStreamBudget }

    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    if (!res.ok) {
      const errText = await res.text()
      send('error', { content: `Upstream ${res.status}: ${errText.slice(0, 400)}` })
      return
    }

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let iterText = ''
    let iterThinking = ''
    const toolCallMap: Record<number, { id: string; name: string; args: string }> = {}

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
        try {
          const chunk = JSON.parse(line.slice(6))
          // Usage arrives in a final chunk whose choices[] is empty — capture it
          // BEFORE bailing on the missing delta, or tokens never get counted.
          if (chunk.usage) {
            totalUsage.prompt += chunk.usage.prompt_tokens || 0
            totalUsage.completion += chunk.usage.completion_tokens || 0
            totalUsage.cached += chunk.usage.prompt_tokens_details?.cached_tokens || 0
          }
          const delta = chunk.choices?.[0]?.delta
          if (!delta) continue

          if (delta.content) {
            iterText += delta.content
            send('text', { content: delta.content })
          }
          if (delta.reasoning_content || delta.reasoning) {
            const t = delta.reasoning_content || delta.reasoning
            iterThinking += t
            send('thinking', { content: t })
          }
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0
              if (!toolCallMap[idx]) toolCallMap[idx] = { id: tc.id || '', name: '', args: '' }
              if (tc.id) toolCallMap[idx].id = tc.id
              if (tc.function?.name) toolCallMap[idx].name = tc.function.name
              if (tc.function?.arguments) toolCallMap[idx].args += tc.function.arguments
            }
          }
        } catch { /* skip */ }
      }
    }

    const toolCalls = Object.values(toolCallMap)
    if (toolCalls.length === 0) {
      send('done', { input_tokens: totalUsage.prompt, output_tokens: totalUsage.completion, cache_read_tokens: totalUsage.cached || undefined })
      return
    }

    const assistantMsg: any = { role: 'assistant', content: iterText || null, tool_calls: toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } })) }
    loopMessages.push(assistantMsg)

    const results = await Promise.all(
      toolCalls.map(async (tc) => {
        let fnArgs: Record<string, any> = {}
        try { fnArgs = JSON.parse(tc.args || '{}') } catch { /* empty */ }
        const result = await executeTool(tc.name, fnArgs)
        toolCallCount++
        send('tool_call', { name: tc.name, input: fnArgs, result: result.slice(0, 4000) })
        return { role: 'tool' as const, tool_call_id: tc.id, content: FETCH_TOOL_NAMES.has(tc.name) ? result.slice(0, 6000) : summarizeToolResult(toolResultForHistory(tc.name, result)) }
      }),
    )
    loopMessages.push(...results)
  }

  send('done', { input_tokens: totalUsage.prompt, output_tokens: totalUsage.completion, cache_read_tokens: totalUsage.cached || undefined })
}
