export type ChatWindowRole = 'chat' | 'work' | 'archived'

export function normalizeChatWindowRole(value: unknown): ChatWindowRole {
  return value === 'work' || value === 'archived' ? value : 'chat'
}

export function mergeChatWindowRole(existing: any, incoming: any) {
  const existingAt = Math.max(0, Number(existing?.windowRoleUpdatedAt) || 0)
  const incomingAt = Math.max(0, Number(incoming?.windowRoleUpdatedAt) || 0)
  const source = incomingAt > existingAt || (incomingAt === existingAt && incoming?.windowRole)
    ? incoming
    : existing
  return {
    windowRole: normalizeChatWindowRole(source?.windowRole),
    windowRoleUpdatedAt: Math.max(existingAt, incomingAt),
  }
}
