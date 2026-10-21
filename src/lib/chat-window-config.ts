import { isCcEffort } from '@/lib/cc-model'
import type { CcContextState, ChatWindowConfig } from '@/features/chat/state/types'

const safeId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,180}$/.test(value)
  ? value
  : undefined

export function normalizeChatWindowConfig(value: unknown): ChatWindowConfig | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  const systemPrompt = typeof input.systemPrompt === 'string' && input.systemPrompt.trim()
    ? input.systemPrompt
    : undefined
  const config: ChatWindowConfig = {
    systemPrompt,
    apiProfileId: safeId(input.apiProfileId),
    apiModelId: safeId(input.apiModelId),
    ccEffort: isCcEffort(input.ccEffort) ? input.ccEffort : undefined,
  }
  return Object.values(config).some(item => item !== undefined) ? config : undefined
}

export function normalizeCcContextState(value: unknown): CcContextState | undefined {
  if (!value || typeof value !== 'object') return undefined
  const input = value as Record<string, unknown>
  const rawWarning = input.warningLevel ?? input.ccContextWarningLevel
  const warningLevel = rawWarning === 85 || rawWarning === 95 ? rawWarning : undefined
  const rawCompactionValue = input.lastCompaction ?? input.lastCcCompaction
  const rawCompaction = rawCompactionValue && typeof rawCompactionValue === 'object'
    ? rawCompactionValue as Record<string, unknown>
    : null
  const compactionAt = Number(rawCompaction?.at)
  const tokenCount = (token: unknown) => Number.isSafeInteger(token) && Number(token) >= 0 && Number(token) <= 10_000_000
    ? Number(token)
    : undefined
  const lastCompaction = rawCompaction
    && Number.isSafeInteger(compactionAt) && compactionAt > 0
    && (rawCompaction.source === 'automatic' || rawCompaction.source === 'manual')
    ? {
        at: compactionAt,
        source: rawCompaction.source,
        beforeTokens: tokenCount(rawCompaction.beforeTokens),
        afterTokens: tokenCount(rawCompaction.afterTokens),
      } satisfies NonNullable<CcContextState['lastCompaction']>
    : undefined
  const state: CcContextState = { warningLevel, lastCompaction }
  return Object.values(state).some(item => item !== undefined) ? state : undefined
}

export function ccContextLevel(value: unknown): 0 | 70 | 85 | 95 {
  const percentage = Number(value)
  if (!Number.isFinite(percentage)) return 0
  if (percentage >= 95) return 95
  if (percentage >= 85) return 85
  if (percentage >= 70) return 70
  return 0
}

/** Window settings are one small sync unit so stale devices cannot mix fields. */
export function mergeChatWindowConfig(existing: any, incoming: any) {
  const existingAt = Math.max(0, Number(existing?.windowConfigUpdatedAt) || 0)
  const incomingAt = Math.max(0, Number(incoming?.windowConfigUpdatedAt) || 0)
  const source = incomingAt > existingAt || (incomingAt === existingAt && incoming?.windowConfig)
    ? incoming
    : existing
  return {
    windowConfig: normalizeChatWindowConfig(source?.windowConfig),
    windowConfigUpdatedAt: Math.max(existingAt, incomingAt),
  }
}

/** Context telemetry syncs separately so it cannot overwrite model or SP choices. */
export function mergeCcContextState(existing: any, incoming: any) {
  const stateOf = (value: any) => value && ('ccContextState' in value || 'ccContextStateUpdatedAt' in value)
    ? normalizeCcContextState(value.ccContextState)
    : normalizeCcContextState(value?.windowConfig)
  const timestampOf = (value: any) => stateOf(value)
    ? Math.max(0, Number(value?.ccContextStateUpdatedAt ?? value?.windowConfigUpdatedAt) || 0)
    : Math.max(0, Number(value?.ccContextStateUpdatedAt) || 0)
  const existingAt = timestampOf(existing)
  const incomingAt = timestampOf(incoming)
  const source = incomingAt > existingAt || (incomingAt === existingAt && stateOf(incoming))
    ? incoming
    : existing
  return {
    ccContextState: stateOf(source),
    ccContextStateUpdatedAt: Math.max(existingAt, incomingAt),
  }
}
