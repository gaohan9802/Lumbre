import {
  migrateLegacyModelCredentials,
  listModelCredentialStatus,
  resolveModelCredential,
  resolveModelCredentialByUpstream,
  type ModelCredentialInput,
  type ModelProvider,
} from '@/server/data/repositories/model-credentials'

export interface ClientModelProfile {
  id: string
  name: string
  provider: ModelProvider
  defaultModel: string
  models: unknown[]
  lastFetchedAt?: number
  credentialConfigured?: boolean
  upstreamOrigin?: string
}

export function sanitizeModelProfiles(profiles: unknown): ClientModelProfile[] {
  if (!Array.isArray(profiles)) return []
  migrateLegacyModelCredentials(profiles)
  return profiles.filter((profile: any) => profile?.id).map((profile: any) => {
    const credential = resolveChatCredential(String(profile.id))
    return {
      id: String(profile.id),
      name: String(profile.name || 'New API'),
      provider: profile.provider === 'openai-compatible' ? 'openai-compatible' : 'anthropic',
      defaultModel: String(profile.defaultModel || (profile.provider === 'openai-compatible' ? 'gpt-4o' : 'claude-sonnet-4-20250514')),
      models: Array.isArray(profile.models) ? profile.models : [],
      lastFetchedAt: typeof profile.lastFetchedAt === 'number' ? profile.lastFetchedAt : undefined,
      credentialConfigured: !!credential,
      upstreamOrigin: credential ? new URL(credential.baseUrl).origin : undefined,
    }
  })
}

export function sanitizeChatConfig(config: any): any {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config
  const safe = { ...config }
  if ('apiProfiles' in safe) safe.apiProfiles = sanitizeModelProfiles(safe.apiProfiles)
  delete safe.apiKey
  delete safe.baseUrl
  return safe
}

export function resolveChatCredential(profileId: unknown): ModelCredentialInput | null {
  const id = typeof profileId === 'string' ? profileId.trim() : ''
  if (id) {
    const stored = resolveModelCredential(id)
    if (stored) return stored
    if (id !== 'anthropic-default') return null
  }
  const apiKey = process.env.CLAUDE_API_KEY?.trim() || ''
  if (!apiKey) return null
  return {
    id: 'anthropic-default',
    provider: 'anthropic',
    baseUrl: process.env.CLAUDE_API_BASE || 'https://api.anthropic.com',
    apiKey,
  }
}

export function resolveLegacyChatCredential(provider: unknown, baseUrl: unknown): ModelCredentialInput | null {
  const normalizedProvider: ModelProvider = provider === 'openai-compatible' ? 'openai-compatible' : 'anthropic'
  return resolveModelCredentialByUpstream(normalizedProvider, typeof baseUrl === 'string' ? baseUrl : '')
}

export function listChatCredentialStatus() {
  const profiles = listModelCredentialStatus()
  if (process.env.CLAUDE_API_KEY?.trim() && !profiles.some(profile => profile.id === 'anthropic-default')) {
    let upstreamOrigin = 'https://api.anthropic.com'
    try { upstreamOrigin = new URL(process.env.CLAUDE_API_BASE || upstreamOrigin).origin } catch {}
    profiles.push({ id: 'anthropic-default', provider: 'anthropic', upstreamOrigin, configured: true, updatedAt: 'environment' })
  }
  return profiles
}
