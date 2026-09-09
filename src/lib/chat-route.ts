export type ChatRoute = 'api' | 'claude-code'

export const DEFAULT_CHAT_ROUTE: ChatRoute = 'api'

export function normalizeChatRoute(value: unknown): ChatRoute {
  return value === 'claude-code' ? 'claude-code' : DEFAULT_CHAT_ROUTE
}

/** A route choice is session metadata, so an older device must not erase a
 * newer selection merely because it uploaded a newer message snapshot. */
export function mergeConversationRoute(existing: any, incoming: any) {
  const existingAt = Math.max(0, Number(existing?.generationRouteUpdatedAt) || 0)
  const incomingAt = Math.max(0, Number(incoming?.generationRouteUpdatedAt) || 0)
  const incomingHasRoute = incoming?.generationRoute === 'api' || incoming?.generationRoute === 'claude-code'
  const source = incomingAt > existingAt || (incomingAt === existingAt && incomingHasRoute)
    ? incoming
    : existing
  return {
    generationRoute: normalizeChatRoute(source?.generationRoute),
    generationRouteUpdatedAt: Math.max(existingAt, incomingAt),
  }
}

export function chatRouteLabel(route: unknown) {
  return normalizeChatRoute(route) === 'claude-code' ? 'CC' : 'API'
}

export function isRecoverableChatDisconnect(route: unknown, explicitlyStopped: boolean, errorName: unknown) {
  return !explicitlyStopped && (errorName === 'AbortError' || normalizeChatRoute(route) === 'claude-code')
}
