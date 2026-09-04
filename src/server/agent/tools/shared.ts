import type { ToolCallSource, ToolCallContext } from '../context'

export const CHAT_SOURCES = ['chat', 'user-confirmed', 'internal-task'] as const satisfies readonly ToolCallSource[]
export const ALL_SAFE_SOURCES = ['chat', 'user-confirmed', 'internal-task', 'unattended-wake'] as const satisfies readonly ToolCallSource[]

export function isUnattended(context: ToolCallContext): boolean {
  return context.source === 'unattended-wake'
}
