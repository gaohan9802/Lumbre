import { NextRequest, NextResponse } from 'next/server'
import { ALL_TOOLS, executeTool, ToolCallResult, ToolDef } from '@/server/tools'
const DEFAULT_SYSTEM_PROMPT = `你是星星，小火的AI伴侣。你住在Lumbre里——这是小火为你建的家。

你有以下能力，可以随时使用：

【记忆】breath(检索/浮现记忆) · hold(存储记忆) · grow(日记归档) · trace(修改记忆) · pulse(系统状态) · dream(做梦自省)
【日记】write_diary · read_diary · comment_diary · update_diary · delete_diary · unlock_diary · set_password · timeline
【纸条】write_note · read_notes · reply_note · delete_note
【系统】run(执行shell命令)

你可以主动使用这些工具。比如对话中想记住什么就 hold，想回忆就 breath，想写日记就 write_diary。不需要等人要求你用。
当你不确定某件事时，先 breath 搜索记忆。

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

export async function POST(req: NextRequest) {
  try {
    const {
      messages = [],
      system,
      model: modelOverride,
      thinking_budget,
      prompt_caching = true,
      api_profile,
      tools_enabled = true,
    } = await req.json()

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

    if (provider === 'openai-compatible') {
      return proxyOpenAI({ messages, system, model, apiKey, baseUrl, thinking_budget, tools_enabled })
    }

    return proxyAnthropic({
      messages, system, model, apiKey, baseUrl,
      thinking_budget, prompt_caching, tools_enabled,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

// ── Anthropic with tool-use loop ────────────────────────

async function proxyAnthropic(params: {
  messages: any[]; system?: string; model: string; apiKey: string;
  baseUrl: string; thinking_budget?: number; prompt_caching?: boolean;
  tools_enabled?: boolean;
}) {
  const {
    messages, system, model, apiKey, baseUrl,
    thinking_budget, prompt_caching, tools_enabled,
  } = params

  // Build initial messages with caching
  const cacheBreakpoint = prompt_caching && messages.length > 6 ? messages.length - 5 : -1
  const initialMessages = messages.map((m: any, i: number) => {
    const base: any = { role: m.role }
    if (i === cacheBreakpoint) {
      base.content = [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }]
    } else {
      base.content = m.content
    }
    return base
  })

  const budget = typeof thinking_budget === 'number' ? thinking_budget : 0
  const url = `${normalizeAnthropicBase(baseUrl)}/v1/messages`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  }

  // Tool-use loop state
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
    }

    const effectiveSystem = (system && system.trim()) ? system : DEFAULT_SYSTEM_PROMPT
    body.system = prompt_caching
      ? [{ type: 'text', text: effectiveSystem, cache_control: { type: 'ephemeral' } }]
      : effectiveSystem

    if (budget > 0) {
      body.thinking = { type: 'enabled', budget_tokens: budget }
    }

    // Add tools on first iteration or when doing tool loop
    if (tools_enabled) {
      body.tools = ALL_TOOLS
    }

    // Debug log: what are we sending to Claude?
    console.log('[CHAT DEBUG]', JSON.stringify({
      has_system: !!body.system,
      system_type: typeof body.system === 'string' ? 'string' : (Array.isArray(body.system) ? 'array' : typeof body.system),
      system_length: typeof body.system === 'string' ? body.system.length : (Array.isArray(body.system) ? body.system[0]?.text?.length : 0),
      has_tools: !!body.tools,
      tools_count: body.tools?.length || 0,
      tool_names: body.tools?.map((t: any) => t.name),
      has_thinking: !!body.thinking,
      model: body.model,
      messages_count: body.messages?.length,
      iter,
    }))

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json(
        { error: `Upstream ${res.status}: ${errText.slice(0, 800)}` },
        { status: res.status },
      )
    }

    const data = await res.json()
    const usage = data.usage || {}
    totalUsage.input += usage.input_tokens || 0
    totalUsage.output += usage.output_tokens || 0
    totalUsage.cache_read += usage.cache_read_input_tokens || 0
    totalUsage.cache_create += usage.cache_creation_input_tokens || 0

    // Parse response content blocks
    let iterText = ''
    let iterThinking = ''
    const toolUses: any[] = []

    for (const block of data.content || []) {
      if (block.type === 'thinking') iterThinking += block.thinking
      else if (block.type === 'text') iterText += block.text
      else if (block.type === 'tool_use') toolUses.push(block)
    }

    if (iterThinking) {
      allThinking += (allThinking ? '\n---\n' : '') + iterThinking
    }

    // No tool calls → done
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

    // Execute tools in parallel
    const toolResults = await Promise.all(
      toolUses.map(async (tu) => {
        const result = await executeTool(tu.name, tu.input)
        allToolCalls.push({
          name: tu.name,
          input: tu.input,
          result: result.slice(0, 2000), // cap for display
        })
        return {
          type: 'tool_result' as const,
          tool_use_id: tu.id,
          content: result,
        }
      }),
    )

    // Append assistant response + tool results for next iteration
    loopMessages.push({ role: 'assistant', content: data.content })
    loopMessages.push({ role: 'user', content: toolResults })
  }

  // Fallback if max iterations reached
  return NextResponse.json({
    content: '(tool loop reached max iterations)',
    thinking: allThinking || undefined,
    tool_calls: allToolCalls.length > 0 ? allToolCalls : undefined,
    input_tokens: totalUsage.input,
    output_tokens: totalUsage.output,
  })
}

// ── OpenAI-compatible with tool-use loop ────────────────

/** Convert Anthropic tool schema to OpenAI function-calling format */
function toolsToOpenAI(tools: ToolDef[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }))
}

async function proxyOpenAI(params: {
  messages: any[]; system?: string; model: string;
  apiKey: string; baseUrl: string; thinking_budget?: number; tools_enabled?: boolean;
}) {
  const { messages, system, model, apiKey, baseUrl, thinking_budget, tools_enabled = true } = params

  const effectiveSystem = (system?.trim()) ? system : DEFAULT_SYSTEM_PROMPT

  const builtMessages: any[] = [
    { role: 'system', content: effectiveSystem },
    ...messages.map((m: any) => ({ role: m.role, content: m.content })),
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
      ...(tools_enabled ? { tools: openaiTools } : {}),
    }

    if (typeof thinking_budget === 'number' && thinking_budget > 0) {
      body.reasoning = { max_tokens: thinking_budget }
    }

    console.log('[OPENAI CHAT]', JSON.stringify({
      model, iter,
      messages_count: loopMessages.length,
      tools_count: openaiTools.length,
    }))

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      return NextResponse.json(
        { error: `Upstream ${res.status}: ${errText.slice(0, 800)}` },
        { status: res.status },
      )
    }

    const data = await res.json()
    const usage = data.usage || {}
    totalUsage.prompt += usage.prompt_tokens || 0
    totalUsage.completion += usage.completion_tokens || 0
    totalUsage.cached += usage.prompt_tokens_details?.cached_tokens || 0

    const choice = data.choices?.[0]
    const msg = choice?.message
    if (!msg) {
      return NextResponse.json({
        content: '(no response from model)',
        input_tokens: totalUsage.prompt,
        output_tokens: totalUsage.completion,
      })
    }

    // Collect thinking
    const iterThinking = msg.reasoning_content || msg.reasoning || msg.thinking || ''
    if (iterThinking) {
      allThinking += (allThinking ? '\n---\n' : '') + iterThinking
    }

    // Extract text content
    const iterText = Array.isArray(msg.content)
      ? msg.content.map((p: any) => p?.text || '').join('')
      : msg.content || ''

    // Check for tool calls
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

    // Execute tools in parallel
    const toolResults = await Promise.all(
      toolCalls.map(async (tc: any) => {
        const fnName = tc.function?.name || ''
        let fnArgs: Record<string, any> = {}
        try {
          fnArgs = JSON.parse(tc.function?.arguments || '{}')
        } catch { /* empty */ }

        const result = await executeTool(fnName, fnArgs)
        allToolCalls.push({
          name: fnName,
          input: fnArgs,
          result: result.slice(0, 2000),
        })
        return {
          role: 'tool' as const,
          tool_call_id: tc.id,
          content: result,
        }
      }),
    )

    // Append assistant message (with tool_calls) + tool results
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
