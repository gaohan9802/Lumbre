import type { ChatMessage, ChatSettings } from '../state/types'

export function findModelMeta(settings: ChatSettings, providerId?: string, modelId?: string) {
  const profile = settings.apiProfiles.find(item => item.id === providerId)
  return profile?.models.find(model => model.id === modelId)
}

export function estimateMsgCost(settings: ChatSettings, message: ChatMessage): number {
  const meta = findModelMeta(settings, message.providerId, message.modelId)
  if (!meta) return 0
  return (
    (message.input_tokens || 0) * (meta.inputPrice || 0)
    + (message.output_tokens || 0) * (meta.outputPrice || 0)
    + (message.cache_read_tokens || 0) * (meta.cachePrice || 0)
  ) / 1e6
}

export function estimateTokens(text: string): number {
  return text ? Math.ceil(text.length / 3.5) : 0
}
