import { createHash, randomUUID } from 'node:crypto'
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
  input: Record<string, any>
  actorId: string
  sessionId?: string
  requestedSource: ToolCallSource
  requestedAt: string
  expiresAt: string
  status: 'pending' | 'confirmed' | 'rejected' | 'expired'
  resolvedAt?: string
}

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

export function createToolConfirmation(
  data: Omit<PendingToolConfirmation, 'id' | 'tokenHash' | 'requestedAt' | 'expiresAt' | 'status'>,
  options: { now?: Date; ttlMs?: number } = {},
): { token: string; confirmation: PendingToolConfirmation } {
  const now = options.now || new Date()
  const token = randomUUID()
  const confirmation: PendingToolConfirmation = {
    ...data,
    id: randomUUID(),
    tokenHash: hashToken(token),
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (options.ttlMs || DEFAULT_TTL_MS)).toISOString(),
    status: 'pending',
  }
  updateJsonFile(FILE, { fallback, fallbackOnInvalid: true, validate: isStore }, current => ({
    version: 1 as const,
    items: [...current.items.filter(item => new Date(item.expiresAt).getTime() > now.getTime() - 24 * 60 * 60 * 1000), confirmation].slice(-200),
  }))
  return { token, confirmation }
}

export type ResolveConfirmationResult =
  | { ok: true; confirmation: PendingToolConfirmation }
  | { ok: false; code: 'not-found' | 'forbidden' | 'expired' | 'already-used'; confirmation?: PendingToolConfirmation }

export function resolveToolConfirmation(
  token: string,
  actorId: string,
  sessionId: string | undefined,
  approve: boolean,
  now = new Date(),
): ResolveConfirmationResult {
  let result: ResolveConfirmationResult = { ok: false, code: 'not-found' }
  updateJsonFile(FILE, { fallback, fallbackOnInvalid: true, validate: isStore }, current => {
    const tokenHash = hashToken(token)
    const index = current.items.findIndex(item => item.tokenHash === tokenHash)
    if (index < 0) return current
    const item = current.items[index]
    if (item.actorId !== actorId || (item.sessionId || undefined) !== (sessionId || undefined)) {
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
    result = { ok: true, confirmation: resolved }
    return { ...current, items }
  })
  return result
}
