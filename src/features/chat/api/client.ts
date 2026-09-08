import type { ApiProvider, ChatMessage, ChatSession } from '../state/types'

export class ChatApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
    this.name = 'ChatApiError'
  }
}

export type CcStatus = {
  configured: boolean
  available: boolean
  toolsAvailable: boolean
  model: string | null
  version: string | null
  quota: {
    available: boolean
    reason?: string
    source: string
    collectedAt: string | null
    stale?: boolean
    fiveHour?: { usedPercentage: number; resetsAt: string | null } | null
    sevenDay?: { usedPercentage: number; resetsAt: string | null } | null
  }
  context: {
    available: boolean
    reason?: string
    source: string
    collectedAt: string | null
    usedTokens?: number
    maxTokens?: number | null
    usedPercentage?: number | null
    model?: string | null
    cacheReadTokens?: number
    cacheCreationTokens?: number
  }
}

export async function chatApiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 15_000,
) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (init.signal?.aborted) abort()
  init.signal?.addEventListener('abort', abort, { once: true })
  const timer = timeoutMs > 0 ? setTimeout(abort, timeoutMs) : null
  try {
    return await fetch(input, { ...init, signal: controller.signal, cache: 'no-store' })
  } finally {
    if (timer) clearTimeout(timer)
    init.signal?.removeEventListener('abort', abort)
  }
}

async function chatApiJson<T = any>(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const response = await chatApiFetch(input, init, timeoutMs)
  const text = await response.text()
  let data: any = {}
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!response.ok) throw new ChatApiError(data?.error || data?.message || `请求失败 (${response.status})`, response.status)
  return data as T
}

function jsonInit(method: 'POST' | 'DELETE', body: unknown, signal?: AbortSignal): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  }
}

type SessionMeta = Pick<ChatSession, 'title' | 'pinned' | 'createdAt' | 'summaryConfig' | 'generationRoute' | 'generationRouteUpdatedAt' | 'conversationMode' | 'conversationModeUpdatedAt'>

export const chatApi = {
  stream: (body: unknown, signal: AbortSignal) =>
    chatApiFetch('/api/chat', jsonInit('POST', body, signal), 0),

  summarize: (body: unknown) =>
    chatApiJson<{ content: string; title?: string }>('/api/chat/summary', jsonInit('POST', body), 0),

  confirmTool: (body: { token: string; approve: boolean; session_id?: string }) =>
    chatApiJson<{ ok: boolean; result?: string }>('/api/tools/confirm', jsonInit('POST', body), 25_000),

  ccStatus: (conversationId?: string) => chatApiJson<CcStatus>(`/api/chat/cc-status${conversationId ? `?conversation_id=${encodeURIComponent(conversationId)}` : ''}`, {}, 6_000),

  cancelCcAttempt: (body: { session_id: string; turn_id: string }) =>
    chatApiJson<{ ok: boolean; attempt?: { id: string; status: string } }>('/api/chat/cc-attempt/cancel', jsonInit('POST', body), 8_000),

  appendMessage: (sessionId: string, message: ChatMessage, sessionMeta: SessionMeta) =>
    chatApiJson('/api/sync', jsonInit('POST', { action: 'append_message', sessionId, message, sessionMeta }), 25_000),

  models: (profileId: string) =>
    chatApiJson<{ models?: any[] }>('/api/models', jsonInit('POST', { profileId }), 25_000),

  modelProfiles: {
    list: () => chatApiJson<{ profiles?: any[] }>('/api/model-profiles'),
    save: (profile: { id: string; provider: ApiProvider; baseUrl: string; apiKey: string }) =>
      chatApiJson('/api/model-profiles', jsonInit('POST', profile), 25_000),
    saveMany: (profiles: Array<{ id: string; provider: ApiProvider; baseUrl: string; apiKey: string }>) =>
      chatApiJson('/api/model-profiles', jsonInit('POST', { profiles }), 25_000),
    remove: (id: string) => chatApiJson('/api/model-profiles', jsonInit('DELETE', { id }), 25_000),
  },
}
