export type ToolCallSource = 'chat' | 'user-confirmed' | 'unattended-wake' | 'internal-task'

export interface ToolCallContext {
  actorId: string
  sessionId?: string
  source: ToolCallSource
  requestedAt: string
}

export interface CreateToolContextOptions {
  actorId?: string
  sessionId?: string
  source?: ToolCallSource
  now?: Date
}

export function createToolContext(options: CreateToolContextOptions = {}): ToolCallContext {
  return {
    actorId: options.actorId || 'lumbre-authenticated-user',
    sessionId: options.sessionId || undefined,
    source: options.source || 'chat',
    requestedAt: (options.now || new Date()).toISOString(),
  }
}
