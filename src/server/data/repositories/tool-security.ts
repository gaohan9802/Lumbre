import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { getDataDir } from '../config'
import { updateJsonFile } from '../json-file'
import { resolveDataPath } from '../safe-path'
import type { ToolCallSource } from '../../agent/context'

const FILE = resolveDataPath(getDataDir(), 'tool-confirmations.json')
const DEFAULT_TTL_MS = 5 * 60 * 1000

export interface PendingToolConfirmation {
  id: string
  tokenHash: string
  tool: string
  actorId: string
  sessionId?: string
  requestedSource: ToolCallSource
  requestedAt: string
  expiresAt: string
  status: 'pending' | 'confirmed' | 'rejected' | 'expired'
  resolvedAt?: string
}

interface ConfirmationTokenPayload {
  id: string
  tool: string
  input: Record<string, any>
  actorId: string
  sessionId?: string
  requestedSource: ToolCallSource
  requestedAt: string
  expiresAt: string
}

export type ResolvedToolConfirmation = PendingToolConfirmation & { input: Record<string, any> }

interface ConfirmationStore {
  version: 1
  items: PendingToolConfirmation[]
}

function fallback(): ConfirmationStore {
  return { version: 1, items: [] }
}

function isStore(value: unknown): value is ConfirmationStore {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as ConfirmationStore).version === 1
    && Array.isArray((value as ConfirmationStore).items)
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function encryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const secret = env.LUMBRE_INTERNAL_SECRET || env.LUMBRE_AUTH_SECRET || env.LUMBRE_ACCESS_PASSWORD || ''
  if (secret.length < 12) throw new Error('Tool confirmations require a configured Lumbre server secret')
  return createHash('sha256').update(secret).digest()
}

function encryptPayload(payload: ConfirmationTokenPayload): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64url')).join('.')
}

function decryptPayload(token: string): ConfirmationTokenPayload | null {
  try {
    const [ivPart, tagPart, encryptedPart, extra] = token.split('.')
    if (!ivPart || !tagPart || !encryptedPart || extra) return null
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivPart, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    const plain = Buffer.concat([decipher.update(Buffer.from(encryptedPart, 'base64url')), decipher.final()]).toString('utf8')
    const parsed = JSON.parse(plain)
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string' || typeof parsed.tool !== 'string' || !parsed.input || typeof parsed.input !== 'object') return null
    return parsed as ConfirmationTokenPayload
  } catch {
    return null
  }
}

export function createToolConfirmation(
  data: Omit<ConfirmationTokenPayload, 'id' | 'requestedAt' | 'expiresAt'>,
  options: { now?: Date; ttlMs?: number } = {},
): { token: string; confirmation: PendingToolConfirmation } {
  const now = options.now || new Date()
  const payload: ConfirmationTokenPayload = {
    ...data,
    id: randomUUID(),
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (options.ttlMs || DEFAULT_TTL_MS)).toISOString(),
  }
  const token = encryptPayload(payload)
  const confirmation: PendingToolConfirmation = {
    id: payload.id,
    tokenHash: hashToken(token),
    tool: payload.tool,
    actorId: payload.actorId,
    sessionId: payload.sessionId,
    requestedSource: payload.requestedSource,
    requestedAt: payload.requestedAt,
    expiresAt: payload.expiresAt,
    status: 'pending',
  }
  updateJsonFile(FILE, { fallback, fallbackOnInvalid: true, validate: isStore }, current => ({
    version: 1 as const,
    items: [...current.items.filter(item => new Date(item.expiresAt).getTime() > now.getTime() - 24 * 60 * 60 * 1000), confirmation].slice(-200),
  }))
  return { token, confirmation }
}

export type ResolveConfirmationResult =
  | { ok: true; confirmation: ResolvedToolConfirmation }
  | { ok: false; code: 'not-found' | 'forbidden' | 'expired' | 'already-used'; confirmation?: PendingToolConfirmation }

export function resolveToolConfirmation(
  token: string,
  actorId: string,
  sessionId: string | undefined,
  approve: boolean,
  now = new Date(),
): ResolveConfirmationResult {
  const payload = decryptPayload(token)
  if (!payload) return { ok: false, code: 'not-found' }
  let result: ResolveConfirmationResult = { ok: false, code: 'not-found' }
  updateJsonFile(FILE, { fallback, fallbackOnInvalid: true, validate: isStore }, current => {
    const tokenHash = hashToken(token)
    const index = current.items.findIndex(item => item.tokenHash === tokenHash)
    if (index < 0) return current
    const item = current.items[index]
    if (
      item.id !== payload.id
      || item.tool !== payload.tool
      || item.actorId !== payload.actorId
      || item.actorId !== actorId
      || (item.sessionId || undefined) !== (payload.sessionId || undefined)
      || (item.sessionId || undefined) !== (sessionId || undefined)
    ) {
      result = { ok: false, code: 'forbidden' }
      return current
    }
    if (item.status !== 'pending') {
      result = { ok: false, code: 'already-used', confirmation: item }
      return current
    }
    if (new Date(item.expiresAt).getTime() <= now.getTime()) {
      const expired = { ...item, status: 'expired' as const, resolvedAt: now.toISOString() }
      const items = [...current.items]
      items[index] = expired
      result = { ok: false, code: 'expired', confirmation: expired }
      return { ...current, items }
    }
    const resolved = { ...item, status: approve ? 'confirmed' as const : 'rejected' as const, resolvedAt: now.toISOString() }
    const items = [...current.items]
    items[index] = resolved
    result = { ok: true, confirmation: { ...resolved, input: payload.input } }
    return { ...current, items }
  })
  return result
}
