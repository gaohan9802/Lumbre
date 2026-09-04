export type GatewayProvider = 'anthropic' | 'openai-compatible'

export interface GatewayUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreate: number
}

export interface GatewayToolCall {
  id: string
  name: string
  input: Record<string, any>
}

export interface GatewayToolExecution extends GatewayToolCall {
  result: string
  modelResult: string
  historyResult: string
  error?: boolean
}

export interface GatewayEmitter {
  (type: 'text' | 'thinking' | 'tool_call' | 'done' | 'error', data: Record<string, any>): void
}

export interface GatewayProviderConfig {
  messages: any[]
  system: string
  bookmarkInjections: string
  volatileContext: string
  model: string
  apiKey: string
  baseUrl: string
  thinkingBudget?: number
  promptCaching?: boolean
  temperature?: number
  origin?: string
  signal?: AbortSignal
}

export interface GatewayTurn {
  text: string
  thinking: string
  toolCalls: GatewayToolCall[]
  usage: GatewayUsage
  finishReason?: string
  rawAssistant: any
}

export interface GatewayProviderSession {
  readonly provider: GatewayProvider
  runTurn(options: { stream: boolean; tools: any[] }): Promise<GatewayTurn>
  appendToolResults(turn: GatewayTurn, results: GatewayToolExecution[]): void
}

export interface GatewayProviderAdapter {
  readonly provider: GatewayProvider
  readonly capabilities: { images: boolean; tools: boolean; thinking: boolean; streaming: boolean }
  createSession(config: GatewayProviderConfig, emit?: GatewayEmitter): Promise<GatewayProviderSession>
}

/**
 * Stable extension point for a future independently deployed Claude Code
 * proxy. Adding that transport must implement this contract; it must not
 * bypass the shared tool loop or gain direct filesystem/process access here.
 */

export const emptyUsage = (): GatewayUsage => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 })
