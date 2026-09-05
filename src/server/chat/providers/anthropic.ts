import { replyTokenLimit } from '@/lib/chat-reply-mode'
import { assertUpstreamOk, fetchUpstreamWithRetry } from '../request'
import type {
  GatewayEmitter, GatewayProviderAdapter, GatewayProviderConfig,
  GatewayProviderSession, GatewayToolExecution, GatewayTurn,
} from './types'
import { emptyUsage } from './types'

const EMPTY_TEXT = '…'

function trimSlash(value: string) { return (value || '').replace(/\/+$/, '') }

function resolvePhotoUrl(value: string, origin?: string): string {
  if (!value || /^https?:\/\//i.test(value) || value.startsWith('data:')) return value
  if (value.startsWith('/')) return origin ? origin + value : value
  return origin ? `${origin}/api/photos/raw/${value}` : value
}

function imageBlock(value: string, origin?: string): any {
  const resolved = resolvePhotoUrl(value, origin)
  const match = /^data:([^;]+);base64,([\s\S]*)$/i.exec(resolved || '')
  return match
    ? { type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } }
    : { type: 'image', source: { type: 'url', url: resolved } }
}

function sanitizeContent(content: any): any {
  if (typeof content === 'string') return content.trim() ? content : EMPTY_TEXT
  if (!Array.isArray(content)) return content
  const blocks = content.map((block: any) => block?.type === 'tool_result' ? { ...block, content: sanitizeContent(block.content) } : block)
    .filter((block: any) => block?.type !== 'text' || !!String(block.text || '').trim())
  return blocks.length ? blocks : [{ type: 'text', text: EMPTY_TEXT }]
}

function buildSystem(config: GatewayProviderConfig): any[] {
  const full = config.system + (config.bookmarkInjections ? `\n\n${config.bookmarkInjections}` : '')
  if (!config.promptCaching) return [{ type: 'text', text: full }]
  const blocks: any[] = [{ type: 'text', text: config.system, cache_control: { type: 'ephemeral' } }]
  if (config.bookmarkInjections) blocks.push({ type: 'text', text: config.bookmarkInjections, cache_control: { type: 'ephemeral' } })
  return blocks
}

function buildMessages(config: GatewayProviderConfig): any[] {
  let lastUser = -1
  let previousUser = -1
  for (let index = config.messages.length - 1; index >= 0; index--) {
    if (config.messages[index]?.role !== 'user') continue
    if (lastUser < 0) lastUser = index
    else { previousUser = index; break }
  }
  let midAnchor = -1
  if (config.promptCaching && previousUser > 20) {
    for (let index = previousUser - 20; index >= 0; index--) {
      if (config.messages[index]?.role === 'user') { midAnchor = index; break }
    }
  }
  return config.messages.map((message: any, index: number) => {
    const images = Array.isArray(message.images) ? message.images.map((image: string) => imageBlock(image, config.origin)) : []
    const text = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
    let content: any = message.content
    if (config.promptCaching && (index === previousUser || index === midAnchor)) content = [...images, { type: 'text', text, cache_control: { type: 'ephemeral' } }]
    else if (index === lastUser) {
      const volatile = `<gateway_volatile_context>仅供参考，勿复述：\n${config.volatileContext}\n</gateway_volatile_context>\n\n${text}`
      content = images.length ? [...images, { type: 'text', text: volatile }] : volatile
    } else if (images.length) content = [...images, { type: 'text', text }]
    return { role: message.role, content: sanitizeContent(content) }
  })
}

function toolResultContent(execution: GatewayToolExecution, origin?: string): any {
  if (execution.name === 'view_foto') {
    try {
      const parsed = JSON.parse(execution.result)
      if (parsed?.url) {
        const { url, ...rest } = parsed
        return [{ type: 'text', text: JSON.stringify(rest) }, imageBlock(url, origin)]
      }
    } catch {}
  }
  return execution.modelResult
}

class AnthropicSession implements GatewayProviderSession {
  readonly provider = 'anthropic' as const
  private readonly system: any[]
  private readonly headers: Record<string, string>
  private readonly url: string
  private readonly budget: number
  private messages: any[]

  constructor(private config: GatewayProviderConfig, private emit?: GatewayEmitter) {
    this.system = buildSystem(config)
    this.messages = buildMessages(config)
    this.url = `${trimSlash(config.baseUrl || 'https://api.anthropic.com')}/v1/messages`
    this.budget = config.thinkingBudget && config.thinkingBudget > 0 ? config.thinkingBudget : 8000
    this.headers = { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, Authorization: `Bearer ${config.apiKey}`, 'anthropic-version': '2023-06-01' }
  }

  async runTurn(options: { stream: boolean; tools: any[] }): Promise<GatewayTurn> {
    const body: any = {
      model: this.config.model,
      max_tokens: replyTokenLimit(this.config.replyMode, this.budget),
      messages: this.messages.map(message => ({ ...message, content: sanitizeContent(message.content) })),
      system: this.system,
      thinking: { type: 'enabled', budget_tokens: this.budget },
      metadata: { user_id: 'lumbre-starfire' },
      ...(options.tools.length ? { tools: options.tools } : {}),
      ...(options.stream ? { stream: true } : {}),
    }
    const response = await fetchUpstreamWithRetry(this.url, { method: 'POST', headers: this.headers, body: JSON.stringify(body), signal: this.config.signal }, { provider: this.provider, model: this.config.model })
    await assertUpstreamOk(response)
    return options.stream ? this.readStream(response) : this.readJson(response)
  }

  private async readJson(response: Response): Promise<GatewayTurn> {
    const data = await response.json()
    let text = ''
    let thinking = ''
    const toolCalls: any[] = []
    for (const block of data.content || []) {
      if (block.type === 'thinking') thinking += block.thinking || ''
      else if (block.type === 'text') text += block.text || ''
      else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, input: block.input || {} })
    }
    return {
      text, thinking, toolCalls, rawAssistant: data.content || [], finishReason: data.stop_reason,
      usage: { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0, cacheRead: data.usage?.cache_read_input_tokens || 0, cacheCreate: data.usage?.cache_creation_input_tokens || 0 },
    }
  }

  private async readStream(response: Response): Promise<GatewayTurn> {
    if (!response.body) throw new Error('Anthropic stream has no body')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const usage = emptyUsage()
    const toolUses: any[] = []
    const args: Record<number, string> = {}
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
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') { text += event.delta.text || ''; this.emit?.('text', { content: event.delta.text || '' }) }
            else if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') { thinking += event.delta.thinking || ''; this.emit?.('thinking', { content: event.delta.thinking || '' }) }
            else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') args[event.index] = (args[event.index] || '') + (event.delta.partial_json || '')
            else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') toolUses.push({ ...event.content_block, index: event.index })
            else if (event.type === 'message_start') { usage.input += event.message?.usage?.input_tokens || 0; usage.cacheRead += event.message?.usage?.cache_read_input_tokens || 0; usage.cacheCreate += event.message?.usage?.cache_creation_input_tokens || 0 }
            else if (event.type === 'message_delta') { finishReason = event.delta?.stop_reason || ''; usage.output += event.usage?.output_tokens || 0 }
          } catch {}
        }
      }
    } catch (error: any) {
      error.hadGatewayOutput = !!(text.trim() || thinking.trim())
      try { await reader.cancel() } catch {}
      throw error
    }
    const toolCalls = toolUses.map(block => {
      let input = {}
      try { input = args[block.index] ? JSON.parse(args[block.index]) : {} } catch {}
      return { id: block.id, name: block.name, input }
    })
    const rawAssistant: any[] = []
    if (text.trim()) rawAssistant.push({ type: 'text', text })
    for (const call of toolCalls) rawAssistant.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input })
    return { text, thinking, toolCalls, usage, finishReason, rawAssistant }
  }

  appendToolResults(turn: GatewayTurn, results: GatewayToolExecution[]) {
    this.messages.push({ role: 'assistant', content: turn.rawAssistant })
    this.messages.push({ role: 'user', content: results.map(result => ({ type: 'tool_result', tool_use_id: result.id, content: toolResultContent(result, this.config.origin) })) })
  }
}

export const anthropicAdapter: GatewayProviderAdapter = {
  provider: 'anthropic',
  capabilities: { images: true, tools: true, thinking: true, streaming: true },
  async createSession(config, emit) { return new AnthropicSession(config, emit) },
}
