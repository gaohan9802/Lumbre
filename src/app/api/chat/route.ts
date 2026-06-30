import { NextRequest, NextResponse } from 'next/server'

/**
 * Proxy to Anthropic Messages API.
 * - Accepts `messages`, `system`, `model`, `thinking_budget`, `prompt_caching`.
 * - When `prompt_caching` is true, adds cache_control breakpoints on:
 *     • the (single) system block
 *     • the message that is N-4 from the end (≈ stable history boundary)
 *   This lets Anthropic reuse cached prefix and we pay ~10% for cached input.
 *   See: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
 */
export async function POST(req: NextRequest) {
  try {
    const {
      messages = [],
      system,
      model: modelOverride,
      thinking_budget,
      prompt_caching = true,
    } = await req.json()

    const apiBase = process.env.CLAUDE_API_BASE || 'https://api.anthropic.com'
    const apiKey = process.env.CLAUDE_API_KEY || ''
    const model = modelOverride || process.env.CLAUDE_MODEL || 'claude-opus-4-5'

    // Build messages array, with cache_control on a stable history boundary.
    // Cache breakpoint goes on the 4th-from-last user message (heuristic that
    // earlier turns are reused while latest turns churn).
    const cacheBreakpoint = prompt_caching && messages.length > 6
      ? messages.length - 5
      : -1

    const builtMessages = messages.map((m: any, i: number) => {
      const base: any = { role: m.role }
      // If we want to mark this turn as cache breakpoint, content must be array.
      if (i === cacheBreakpoint) {
        base.content = [
          { type: 'text', text: m.content, cache_control: { type: 'ephemeral' } },
        ]
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

    // System prompt: when caching is on, send as array w/ cache_control.
    if (system && system.trim()) {
      if (prompt_caching) {
        body.system = [
          { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ]
      } else {
        body.system = system
      }
    }

    // Extended thinking
    const budget = typeof thinking_budget === 'number' ? thinking_budget : 0
    if (budget > 0) {
      body.thinking = { type: 'enabled', budget_tokens: budget }
    }

    const res = await fetch(`${apiBase}/v1/messages`, {
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
      return NextResponse.json(
        { error: `Upstream ${res.status}: ${errText.slice(0, 400)}` },
        { status: res.status },
      )
    }

    const data = await res.json()

    let content = ''
    let thinking = ''
    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'thinking') thinking = block.thinking
        else if (block.type === 'text') content = block.text
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
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
