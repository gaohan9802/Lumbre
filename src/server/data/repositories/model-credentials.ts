import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile } from '../json-file'
import { resolveDataPath } from '../safe-path'

export type ModelProvider = 'anthropic' | 'openai-compatible'

export interface ModelCredentialInput {
  id: string
  provider: ModelProvider
  baseUrl: string
  apiKey: string
}

interface StoredModelCredential {
  id: string
  provider: ModelProvider
  baseUrl: string
  encryptedApiKey: string
  updatedAt: string
}

interface ModelCredentialStore {
  version: 1
  profiles: StoredModelCredential[]
}

const FILE = resolveDataPath(getDataDir(), 'model-gateway', 'credentials.json')

function fallback(): ModelCredentialStore {
  return { version: 1, profiles: [] }
}

function isStore(value: unknown): value is ModelCredentialStore {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as ModelCredentialStore).version === 1
    && Array.isArray((value as ModelCredentialStore).profiles)
}

function encryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const secret = env.LUMBRE_INTERNAL_SECRET || env.LUMBRE_AUTH_SECRET || env.LUMBRE_ACCESS_PASSWORD || ''
  if (secret.length < 12) throw new Error('Model credentials require a configured Lumbre server secret')
  return createHash('sha256').update(`lumbre-model-credentials:${secret}`).digest()
}

function encrypt(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.')
}

function decrypt(value: string): string {
  const [ivPart, tagPart, encryptedPart, extra] = value.split('.')
  if (!ivPart || !tagPart || !encryptedPart || extra) throw new Error('Stored model credential is invalid')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedPart, 'base64url')), decipher.final()]).toString('utf8')
}

export function normalizeModelBaseUrl(raw: string, provider: ModelProvider): string {
  const fallbackUrl = provider === 'anthropic' ? 'https://api.anthropic.com' : 'https://api.openai.com/v1'
  const url = new URL((raw || fallbackUrl).trim())
  if (url.protocol !== 'https:') throw new Error('模型渠道地址必须使用 HTTPS')
  if (url.username || url.password) throw new Error('模型渠道地址不能包含账号或密码')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const blocked = host === 'localhost' || host === '0.0.0.0' || host === '::1' || host.endsWith('.localhost')
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || host === '100.100.100.200' || host === '169.254.169.254'
  if (blocked) throw new Error('模型渠道地址不能指向本机、内网或云平台元数据地址')
  url.hash = ''
  url.search = ''
  return url.toString().replace(/\/$/, '')
}

export function upsertModelCredential(input: ModelCredentialInput): void {
  const id = String(input.id || '').trim()
  const apiKey = String(input.apiKey || '').trim()
  if (!id) throw new Error('模型渠道缺少 ID')
  if (!apiKey) throw new Error('模型渠道缺少 API Key')
  if (/^\[?redacted\]?$/i.test(apiKey) || /^\*+$/.test(apiKey)) throw new Error('脱敏占位符不能作为 API Key 保存')
  const provider: ModelProvider = input.provider === 'openai-compatible' ? 'openai-compatible' : 'anthropic'
  const item: StoredModelCredential = {
    id,
    provider,
    baseUrl: normalizeModelBaseUrl(input.baseUrl, provider),
    encryptedApiKey: encrypt(apiKey),
    updatedAt: new Date().toISOString(),
  }
  updateJsonFile(FILE, { fallback, fallbackOnInvalid: true, validate: isStore }, current => ({
    version: 1 as const,
    profiles: [...current.profiles.filter(profile => profile.id !== id), item],
  }))
  try { fs.chmodSync(FILE, 0o600) } catch {}
}

export function migrateLegacyModelCredentials(profiles: unknown): number {
  if (!Array.isArray(profiles)) return 0
  let migrated = 0
  for (const profile of profiles as any[]) {
    if (!profile?.id || !profile?.apiKey) continue
    try {
      upsertModelCredential({
        id: String(profile.id),
        provider: profile.provider === 'openai-compatible' ? 'openai-compatible' : 'anthropic',
        baseUrl: String(profile.baseUrl || ''),
        apiKey: String(profile.apiKey),
      })
      migrated++
    } catch (error: any) {
      let upstreamOrigin = '(invalid URL)'
      try { upstreamOrigin = new URL(String(profile.baseUrl || '')).origin } catch {}
      console.warn(`[model credential migration skipped] id=${String(profile.id)} origin=${upstreamOrigin} reason=${String(error?.message || error)}`)
    }
  }
  return migrated
}

export function resolveModelCredential(id: string): ModelCredentialInput | null {
  const store = readJsonFile<ModelCredentialStore>(FILE, { fallback, fallbackOnInvalid: true, validate: isStore })
  const item = store.profiles.find(profile => profile.id === id)
  if (!item) return null
  try {
    return { id: item.id, provider: item.provider, baseUrl: item.baseUrl, apiKey: decrypt(item.encryptedApiKey) }
  } catch {
    return null
  }
}

/** Compatibility lookup for pre-stage-3 tabs that do not know profile ids yet. */
export function resolveModelCredentialByUpstream(provider: ModelProvider, rawBaseUrl: string): ModelCredentialInput | null {
  let baseUrl: string
  try { baseUrl = normalizeModelBaseUrl(rawBaseUrl, provider) } catch { return null }
  const store = readJsonFile<ModelCredentialStore>(FILE, { fallback, fallbackOnInvalid: true, validate: isStore })
  const item = store.profiles.find(profile => profile.provider === provider && profile.baseUrl === baseUrl)
  if (!item) return null
  return resolveModelCredential(item.id)
}

export function listModelCredentialStatus(): Array<{ id: string; provider: ModelProvider; upstreamOrigin: string; configured: boolean; updatedAt: string }> {
  const store = readJsonFile<ModelCredentialStore>(FILE, { fallback, fallbackOnInvalid: true, validate: isStore })
  return store.profiles.map(item => ({
    id: item.id,
    provider: item.provider,
    upstreamOrigin: new URL(item.baseUrl).origin,
    configured: !!resolveModelCredential(item.id),
    updatedAt: item.updatedAt,
  }))
}

export function deleteModelCredential(id: string): boolean {
  let removed = false
  updateJsonFile(FILE, { fallback, fallbackOnInvalid: true, validate: isStore }, current => {
    const profiles = current.profiles.filter(profile => profile.id !== id)
    removed = profiles.length !== current.profiles.length
    return removed ? { version: 1 as const, profiles } : current
  })
  return removed
}
