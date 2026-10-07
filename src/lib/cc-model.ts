export const CC_MODELS = [
  { id: 'claude-fable-5-1', name: 'Fable 5.1' },
  { id: 'claude-fable-5', name: 'Fable 5' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5' },
  { id: 'claude-opus-5', name: 'Opus 5' },
  { id: 'claude-opus-4-8', name: 'Opus 4.8' },
  { id: 'claude-opus-4-7', name: 'Opus 4.7' },
  { id: 'claude-opus-4-6', name: 'Opus 4.6' },
  { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5' },
  { id: 'claude-sonnet-5', name: 'Sonnet 5' },
  { id: 'claude-sonnet-4-6', name: 'Sonnet 4.6' },
  { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5' },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5' },
] as const

export type CcModelId = typeof CC_MODELS[number]['id']

export const CC_EFFORTS = [
  { id: 'low', name: '低' },
  { id: 'medium', name: '中' },
  { id: 'high', name: '高' },
  { id: 'xhigh', name: '极高' },
  { id: 'max', name: '最大' },
] as const

export type CcEffort = typeof CC_EFFORTS[number]['id']

export const DEFAULT_CC_MODEL: CcModelId = 'claude-opus-4-6'
export const DEFAULT_CC_EFFORT: CcEffort = 'high'

export function isCcModel(value: unknown): value is CcModelId {
  return CC_MODELS.some(model => model.id === value)
}

export function isCcEffort(value: unknown): value is CcEffort {
  return CC_EFFORTS.some(effort => effort.id === value)
}

export function ccEffortsForModel(model: string): readonly CcEffort[] {
  if (/haiku|(?:opus|sonnet)-4-5/.test(model)) return []
  if (/(?:opus|sonnet)-4-6/.test(model)) return CC_EFFORTS.map(item => item.id).filter(item => item !== 'xhigh')
  return CC_EFFORTS.map(item => item.id)
}

export function normalizeCcEffortForModel(model: string, effort: unknown): CcEffort | undefined {
  if (!isCcEffort(effort)) return undefined
  const available = ccEffortsForModel(model)
  if (!available.length) return undefined
  return available.includes(effort) ? effort : effort === 'xhigh' ? 'high' : undefined
}

/** A model choice is session metadata, so a stale device cannot erase it. */
export function mergeCcModel(existing: any, incoming: any) {
  const existingAt = Math.max(0, Number(existing?.ccModelUpdatedAt) || 0)
  const incomingAt = Math.max(0, Number(incoming?.ccModelUpdatedAt) || 0)
  const source = incomingAt > existingAt || (incomingAt === existingAt && isCcModel(incoming?.ccModel))
    ? incoming
    : existing
  return {
    ccModel: isCcModel(source?.ccModel) ? source.ccModel : undefined,
    ccModelUpdatedAt: Math.max(existingAt, incomingAt),
  }
}
