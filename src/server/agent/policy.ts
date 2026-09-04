import type { ToolCallContext } from './context'
import type { RegisteredTool, ToolPolicyDecision, ToolRiskLevel } from './types'

export function resolveToolRisk(tool: RegisteredTool, input: Record<string, any>): ToolRiskLevel {
  return tool.resolveLevel ? tool.resolveLevel(input) : tool.level
}

export function evaluateToolPolicy(
  tool: RegisteredTool,
  input: Record<string, any>,
  context: ToolCallContext,
  confirmed = false,
): ToolPolicyDecision {
  const level = resolveToolRisk(tool, input)
  if (level === 'black') return { allowed: false, level, reason: 'Black-level operations are never allowed' }

  if (!tool.allowedSources.includes(context.source)) {
    return {
      allowed: false,
      level: context.source === 'unattended-wake' && level === 'red' ? 'black' : level,
      reason: `${tool.name} is not allowed from ${context.source}`,
    }
  }

  if (context.source === 'unattended-wake' && level === 'red') {
    return { allowed: false, level: 'black', reason: 'Unattended wake cannot perform red-level operations' }
  }

  if (level === 'red' && !confirmed) {
    return { allowed: false, level, requiresConfirmation: true, reason: 'Current user confirmation is required' }
  }

  return { allowed: true, level }
}

export function confirmationTarget(name: string, input: Record<string, any>): string | undefined {
  const candidates = name === 'send_email'
    ? [input.to]
    : name === 'reply_email'
      ? [input.id]
      : [input.id, input.bucket_id, input.note_id, input.target_date]
  const value = candidates.find(item => typeof item === 'string' && item.trim())
  return value ? String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 160) : undefined
}
