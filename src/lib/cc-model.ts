export const CC_MODELS = [
  { id: 'claude-opus-4-6', name: 'Opus 4.6' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5' },
] as const

export type CcModelId = typeof CC_MODELS[number]['id']

export const DEFAULT_CC_MODEL: CcModelId = 'claude-opus-4-6'

export function isCcModel(value: unknown): value is CcModelId {
  return CC_MODELS.some(model => model.id === value)
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
