import { replyTokenLimit } from '@/lib/chat-reply-mode'
import { assertUpstreamOk, fetchUpstreamWithRetry } from '../request'
import type {
  GatewayEmitter, GatewayProviderAdapter, GatewayProviderConfig,
  GatewayProviderSession, GatewayToolExecution, GatewayTurn,
} from './types'
import { emptyUsage } from './types'

function trimSlash(value: string) { return (value || '').replace(/\/+$/, '') }

function normalizeBase(value: string) {
  const base = trimSlash(value || 'https://api.openai.com/v1')
  return base.endsWith('/v1') ? base : `${base}/v1`
}

function resolvePhotoUrl(value: string, origin?: string): string {
  if (!value || /^https?:\/\//i.test(value) || value.startsWith('data:')) return value
  if (value.startsWith('/')) return origin ? origin + value : value
  return origin ? `${origin}/api/photos/raw/${value}` : value
}

function imageParts(images: unknown, origin?: string): any[] {
  if (!Array.isArray(images)) return []
  return images.map(value => ({ type: 'image_url', image_url: { url: resolvePhotoUrl(String(value), origin) } }))
}

function buildMessages(config: GatewayProviderConfig): any[] {
  const fullSystem = config.system + (config.bookmarkInjections ? `\n\n${config.bookmarkInjections}` : '')
  let lastUser = -1
  for (let index = config.messages.length - 1; index >= 0; index--) {
    if (config.messages[index]?.role === 'user') { lastUser = index; break }
  }
  return [{ role: 'system', content: fullSystem }, ...config.messages.map((message: any, index: number) => {
    const raw = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
    const text = index === lastUser ? `<gateway_volatile_context>${config.volatileContext}</gateway_volatile_context>\n\n${raw}` : raw
    const images = imageParts(message.images, config.origin)
    return { role: message.role, content: images.length ? [{ type: 'text', text }, ...images] : text }
  })]
}

function toTools(tools: any[]) {
  return tools.map(tool => ({ type: 'function' as const, function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }))
}

class OpenAICompatibleSession implements GatewayProviderSession {
  readonly provider = 'openai-compatible' as const
  private readonly url: string
  private readonly headers: Record<string, string>
  private readonly budget: number
  private messages: any[]

  constructor(private config: GatewayProviderConfig, private emit?: GatewayEmitter) {
    this.url = `${normalizeBase(config.baseUrl)}/chat/completions`
    this.headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}`, 'HTTP-Referer': 'https://lumbre.zeabur.app', 'X-Title': 'Lumbre' }
    this.budget = config.thinkingBudget && config.thinkingBudget > 0 ? config.thinkingBudget : 8000
    this.messages = buildMessages(config)
  }

  async runTurn(options: { stream: boolean; tools: any[] }): Promise<GatewayTurn> {
    const body: any = {
      model: this.config.model,
      messages: this.messages,
      max_tokens: replyTokenLimit(this.config.replyMode, this.budget),
      reasoning: { max_tokens: this.budget },
      ...(options.tools.length ? { tools: toTools(options.tools) } : {}),
      ...(options.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    }
    if (typeof this.config.temperature === 'number') body.temperature = this.config.temperature
    const response = await fetchUpstreamWithRetry(this.url, { method: 'POST', headers: this.headers, body: JSON.stringify(body), signal: this.config.signal }, { provider: this.provider, model: this.config.model })
    await assertUpstreamOk(response)
    return options.stream ? this.readStream(response) : this.readJson(response)
  }

  private async readJson(response: Response): Promise<GatewayTurn> {
    const data = await response.json()
    const message = data.choices?.[0]?.message
    if (!message) return { text: '(no response from model)', thinking: '', toolCalls: [], usage: emptyUsage(), rawAssistant: { role: 'assistant', content: '' } }
    const text = Array.isArray(message.content) ? message.content.map((part: any) => part?.text || '').join('') : message.content || ''
    const thinking = message.reasoning_content || message.reasoning || message.thinking || ''
    const toolCalls = (message.tool_calls || []).map((call: any) => {
      let input = {}
      try { input = JSON.parse(call.function?.arguments || '{}') } catch {}
      return { id: call.id, name: call.function?.name || '', input }
    })
    return {
      text, thinking, toolCalls, rawAssistant: message, finishReason: data.choices?.[0]?.finish_reason,
      usage: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0, cacheRead: data.usage?.prompt_tokens_details?.cached_tokens || 0, cacheCreate: 0 },
    }
  }

  private async readStream(response: Response): Promise<GatewayTurn> {
    if (!response.body) throw new Error('OpenAI-compatible stream has no body')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const usage = emptyUsage()
    const calls: Record<number, { id: string; name: string; args: string }> = {}
    let buffer = ''
    let text = ''
    let thinking = ''
    let finishReason = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
          try {
            const chunk = JSON.parse(line.slice(6))
            if (chunk.usage) { usage.input += chunk.usage.prompt_tokens || 0; usage.output += chunk.usage.completion_tokens || 0; usage.cacheRead += chunk.usage.prompt_tokens_details?.cached_tokens || 0 }
            if (chunk.choices?.[0]?.finish_reason) finishReason = chunk.choices[0].finish_reason
            const delta = chunk.choices?.[0]?.delta
            if (!delta) continue
            if (delta.content) { text += delta.content; this.emit?.('text', { content: delta.content }) }
            const reasoning = delta.reasoning_content || delta.reasoning || ''
            if (reasoning) { thinking += reasoning; this.emit?.('thinking', { content: reasoning }) }
            for (const call of delta.tool_calls || []) {
              const index = call.index ?? 0
              if (!calls[index]) calls[index] = { id: call.id || '', name: '', args: '' }
              if (call.id) calls[index].id = call.id
              if (call.function?.name) calls[index].name = call.function.name
              if (call.function?.arguments) calls[index].args += call.function.arguments
            }
          } catch {}
        }
      }
    } catch (error: any) {
      error.hadGatewayOutput = !!(text.trim() || thinking.trim())
      try { await reader.cancel() } catch {}
      throw error
    }
    const toolCalls = Object.values(calls).map(call => {
      let input = {}
      try { input = JSON.parse(call.args || '{}') } catch {}
      return { id: call.id, name: call.name, input }
    })
    const rawAssistant = { role: 'assistant', content: text || null, tool_calls: Object.values(calls).map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.args } })) }
    return { text, thinking, toolCalls, usage, finishReason, rawAssistant }
  }

  appendToolResults(turn: GatewayTurn, results: GatewayToolExecution[]) {
    this.messages.push(turn.rawAssistant)
    this.messages.push(...results.map(result => ({ role: 'tool', tool_call_id: result.id, content: result.modelResult })))
    const photoParts: any[] = []
    for (const result of results) {
      if (result.name !== 'view_foto') continue
      try {
        const parsed = JSON.parse(result.result)
        if (parsed?.url) photoParts.push({ type: 'image_url', image_url: { url: resolvePhotoUrl(parsed.url, this.config.origin) } })
      } catch {}
    }
    if (photoParts.length) this.messages.push({ role: 'user', content: [{ type: 'text', text: '这是照片墙上照片的画面内容：' }, ...photoParts] })
  }
}

export const openAICompatibleAdapter: GatewayProviderAdapter = {
  provider: 'openai-compatible',
  capabilities: { images: true, tools: true, thinking: true, streaming: true },
  async createSession(config, emit) { return new OpenAICompatibleSession(config, emit) },
}
