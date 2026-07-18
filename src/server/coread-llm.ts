/**
 * Minimal LLM client for co-reading: one non-streaming call (digests) and one
 * streaming call (discussion). Supports Anthropic + OpenAI-compatible endpoints.
 * Profile is passed in from the client's active API profile.
 */

export interface LLMProfile {
  provider: 'anthropic' | 'openai-compatible'
  baseUrl: string
  apiKey: string
  model: string
}

export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

function trimSlash(s: string) { return (s || '').replace(/\/+$/, '') }
function anthropicBase(b: string) { return trimSlash(b || 'https://api.anthropic.com') }
function openaiBase(b: string) {
  const base = trimSlash(b || 'https://api.openai.com/v1')
  return base.endsWith('/v1') ? base : `${base}/v1`
}

/** Non-streaming completion → full text. Used for chapter digests. */
export async function callLLM(
  profile: LLMProfile,
  messages: LLMMessage[],
  system: string,
  opts?: { maxTokens?: number; temperature?: number },
): Promise<string> {
  const maxTokens = opts?.maxTokens ?? 1024
  const temperature = opts?.temperature ?? 0.6

  if (profile.provider === 'openai-compatible') {
    const url = `${openaiBase(profile.baseUrl)}/chat/completions`
    const body = {
      model: profile.model,
      messages: [{ role: 'system', content: system }, ...messages],
      max_tokens: maxTokens,
      temperature,
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${profile.apiKey}` },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json()
    return data?.choices?.[0]?.message?.content || ''
  }

  // anthropic
  const url = `${anthropicBase(profile.baseUrl)}/v1/messages`
  const body = { model: profile.model, system, messages, max_tokens: maxTokens, temperature }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': profile.apiKey,
      Authorization: `Bearer ${profile.apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  const blocks = Array.isArray(data?.content) ? data.content : []
  return blocks.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')
}
