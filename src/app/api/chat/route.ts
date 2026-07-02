import { recordUsage } from '@/server/usage'
import { NextRequest, NextResponse } from 'next/server'
import { ALL_TOOLS, executeTool, ToolCallResult } from '@/server/tools'

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
      return proxyOpenAI({ messages, system, model, apiKey, baseUrl, thinking_budget })
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

    if (system && system.trim()) {
      body.system = prompt_caching
        ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
        : system
    }

    if (budget > 0) {
      body.thinking = { type: 'enabled', budget_tokens: budget }
    }

    // Add tools on first iteration or when doing tool loop
    if (tools_enabled) {
      body.tools = ALL_TOOLS
    }

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

// ── OpenAI-compatible (no tools for now) ────────────────

async function proxyOpenAI(params: {
  messages: any[]; system?: string; model: string;
  apiKey: string; baseUrl: string; thinking_budget?: number;
}) {
  const { messages, system, model, apiKey, baseUrl, thinking_budget } = params

  const builtMessages = [
    ...(system?.trim() ? [{ role: 'system', content: system }] : []),
    ...messages.map((m: any) => ({ role: m.role, content: m.content })),
  ]

  const body: any = { model, messages: builtMessages, max_tokens: 16000 }

  if (typeof thinking_budget === 'number' && thinking_budget > 0) {
    body.reasoning = { max_tokens: thinking_budget }
  }

  const res = await fetch(`${normalizeOpenAIBase(baseUrl)}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://lumbre.zeabur.app',
      'X-Title': 'Lumbre',
    },
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
  const msg = data.choices?.[0]?.message
  const content = Array.isArray(msg?.content)
    ? msg.content.map((p: any) => p?.text || '').join('')
    : msg?.content || ''
  const thinking = msg?.reasoning_content || msg?.reasoning || msg?.thinking || ''
  const usage = data.usage || {}

  return NextResponse.json({
    content,
    thinking: thinking || undefined,
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
    cache_read_tokens: usage.prompt_tokens_details?.cached_tokens,
  })
}
