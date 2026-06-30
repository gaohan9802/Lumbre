import { NextRequest, NextResponse } from 'next/server'

type Provider = 'anthropic' | 'openai-compatible'

function trimSlash(s: string) {
  return (s || '').replace(/\/+$/, '')
}

function normalizeOpenAIBase(baseUrl: string) {
  const base = trimSlash(baseUrl || 'https://api.openai.com/v1')
  return base.endsWith('/v1') ? base : `${base}/v1`
}

function normalizeAnthropicBase(baseUrl: string) {
  return trimSlash(baseUrl || 'https://api.anthropic.com')
}

function getTextFromOpenAI(data: any) {
  const msg = data?.choices?.[0]?.message
  const content = msg?.content
  if (Array.isArray(content)) {
    return content.map((p: any) => p?.text || '').join('')
  }
  return content || data?.choices?.[0]?.text || ''
}

function getReasoningFromOpenAI(data: any) {
  const msg = data?.choices?.[0]?.message || {}
  return msg.reasoning_content || msg.reasoning || msg.thinking || ''
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
    } = await req.json()

    const provider: Provider = api_profile?.provider || 'anthropic'
    const apiKey = api_profile?.apiKey || process.env.CLAUDE_API_KEY || ''
    const baseUrl = api_profile?.baseUrl || process.env.CLAUDE_API_BASE || 'https://api.anthropic.com'
    const model = modelOverride || process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514'

    if (!apiKey) {
      return NextResponse.json(
        { error: '还没有配置 API Key。打开 Chat 设置 → API 密钥管理，添加一个 key。' },
        { status: 400 },
      )
    }

    if (provider === 'openai-compatible') {
      return proxyOpenAICompatible({ messages, system, model, apiKey, baseUrl, thinking_budget })
    }

    return proxyAnthropic({ messages, system, model, apiKey, baseUrl, thinking_budget, prompt_caching })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

async function proxyAnthropic(params: {
  messages: any[]
  system?: string
  model: string
  apiKey: string
  baseUrl: string
  thinking_budget?: number
  prompt_caching?: boolean
}) {
  const { messages, system, model, apiKey, baseUrl, thinking_budget, prompt_caching } = params

  const cacheBreakpoint = prompt_caching && messages.length > 6 ? messages.length - 5 : -1
  const builtMessages = messages.map((m: any, i: number) => {
    const base: any = { role: m.role }
    if (i === cacheBreakpoint) {
      base.content = [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }]
    } else {
      base.content = m.content
    }
    return base
  })

  const body: any = {
    model,
    max_tokens: 16000,
    messages: builtMessages,
  }

  if (system && system.trim()) {
    body.system = prompt_caching
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : system
  }

  const budget = typeof thinking_budget === 'number' ? thinking_budget : 0
  if (budget > 0) {
    body.thinking = { type: 'enabled', budget_tokens: budget }
  }

  const res = await fetch(`${normalizeAnthropicBase(baseUrl)}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errText = await res.text()
    return NextResponse.json({ error: `Upstream ${res.status}: ${errText.slice(0, 800)}` }, { status: res.status })
  }

  const data = await res.json()
  let content = ''
  let thinking = ''
  if (Array.isArray(data.content)) {
    for (const block of data.content) {
      if (block.type === 'thinking') thinking = block.thinking
      else if (block.type === 'text') content += block.text
    }
  }

  const usage = data.usage || {}
  return NextResponse.json({
    content,
    thinking,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read_tokens: usage.cache_read_input_tokens,
    cache_creation_tokens: usage.cache_creation_input_tokens,
  })
}

async function proxyOpenAICompatible(params: {
  messages: any[]
  system?: string
  model: string
  apiKey: string
  baseUrl: string
  thinking_budget?: number
}) {
  const { messages, system, model, apiKey, baseUrl, thinking_budget } = params

  const builtMessages = [
    ...(system && system.trim() ? [{ role: 'system', content: system }] : []),
    ...messages.map((m: any) => ({ role: m.role, content: m.content })),
  ]

  const body: any = {
    model,
    messages: builtMessages,
    max_tokens: 16000,
  }

  // A few compatible gateways accept this. If they ignore it, fine; if they reject it,
  // user can set budget to 0 in settings.
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
    return NextResponse.json({ error: `Upstream ${res.status}: ${errText.slice(0, 800)}` }, { status: res.status })
  }

  const data = await res.json()
  const usage = data.usage || {}
  return NextResponse.json({
    content: getTextFromOpenAI(data),
    thinking: getReasoningFromOpenAI(data),
    input_tokens: usage.prompt_tokens,
    output_tokens: usage.completion_tokens,
    cache_read_tokens: usage.prompt_tokens_details?.cached_tokens,
    cache_creation_tokens: undefined,
  })
}
