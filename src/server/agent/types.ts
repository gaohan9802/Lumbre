import type { ToolCallContext, ToolCallSource } from './context'

export type ToolRiskLevel = 'green' | 'yellow' | 'red' | 'black'

export type ToolDomain =
  | 'memory'
  | 'diary'
  | 'notes'
  | 'photos'
  | 'timeline'
  | 'todo'
  | 'thesis'
  | 'wishes'
  | 'wake'
  | 'context'
  | 'period'
  | 'mail'
  | 'web'
  | 'bookmarks'
  | 'coupons'

export interface ToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
}

export interface ToolPolicySpec {
  name: string
  domain: ToolDomain
  level: ToolRiskLevel
  allowedSources: readonly ToolCallSource[]
  confirmationLabel?: string
  resolveLevel?: (input: Record<string, any>) => ToolRiskLevel
}

export interface RegisteredTool extends ToolPolicySpec {
  definition: ToolDef
  execute: (input: Record<string, any>) => Promise<string>
}

export interface ToolExecutionRequest {
  name: string
  input: Record<string, any>
}

export interface ToolExecutionResult {
  name: string
  input: Record<string, any>
  result: string
  error?: boolean
}

export interface ToolPolicyDecision {
  allowed: boolean
  level: ToolRiskLevel
  reason?: string
  requiresConfirmation?: boolean
}

export interface ToolAuditEvent {
  at: string
  actorId: string
  sessionId?: string
  source: ToolCallSource
  tool: string
  domain: ToolDomain | 'unknown'
  risk: ToolRiskLevel
  outcome: 'allowed' | 'denied' | 'confirmation-required' | 'confirmed' | 'rejected' | 'failed'
  durationMs?: number
  inputKeys: string[]
  target?: string
  error?: string
}

export interface ToolExecutorOptions {
  context: ToolCallContext
  maxCalls?: number
}
