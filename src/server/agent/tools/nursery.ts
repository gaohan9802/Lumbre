import type { ToolPolicySpec, ToolRiskLevel } from '../types'
import { ALL_SAFE_SOURCES } from './shared'

const READ_COMMANDS = new Set(['status', 'help', 'describe', 'album', 'log', 'letters'])
const commandRisk = (input: Record<string, any>): ToolRiskLevel => {
  const head = typeof input.command === 'string' ? input.command.trim().split(/\s+/, 1)[0].replace(/["']/g, '').toLowerCase() : ''
  return READ_COMMANDS.has(head) ? 'green' : 'yellow'
}

export const NURSERY_TOOL_POLICIES: ToolPolicySpec[] = [{
  name: 'nursery',
  domain: 'nursery',
  level: 'green',
  resolveLevel: commandRisk,
  allowedSources: ALL_SAFE_SOURCES,
}]
