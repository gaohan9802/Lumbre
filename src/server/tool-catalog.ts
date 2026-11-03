import { TOOL_DISPLAY_LABELS } from '@/features/chat/tool-display'
import type { ToolCatalogChange, ToolCatalogSnapshot } from '@/lib/tool-catalog'
import { ALL_TOOLS, getRegisteredTool } from './agent/registry'
import { readToolCatalogOverrides, updateToolCatalogOverrides } from './data/repositories/tool-catalog'

function text(value: unknown, max: number) {
  return String(value || '').replace(/\0/g, '').trim().slice(0, max)
}

export function toolCatalogSnapshot(): ToolCatalogSnapshot {
  const overrides = readToolCatalogOverrides()
  return {
    tools: ALL_TOOLS.map(definition => {
      const policy = getRegisteredTool(definition.name)!
      const override = overrides[definition.name] || {}
      const defaultDisplayLabel = TOOL_DISPLAY_LABELS[definition.name] || definition.name
      return {
        name: definition.name,
        domain: policy.domain,
        risk: policy.level,
        conditionalRisk: !!policy.resolveLevel,
        description: override.description || definition.description,
        defaultDescription: definition.description,
        displayLabel: override.displayLabel || defaultDisplayLabel,
        defaultDisplayLabel,
        customizedDescription: !!override.description,
        customizedDisplayLabel: !!override.displayLabel,
      }
    }),
  }
}

export function updateToolCatalog(changesValue: unknown): ToolCatalogSnapshot {
  if (!Array.isArray(changesValue) || changesValue.length > ALL_TOOLS.length) throw new Error('工具修改格式无效')
  const definitions = new Map(ALL_TOOLS.map(definition => [definition.name, definition]))
  const seen = new Set<string>()
  const changes = changesValue.map(value => {
    const change = value as Partial<ToolCatalogChange>
    const name = text(change?.name, 120)
    if (!definitions.has(name) || seen.has(name)) throw new Error('包含未知或重复的工具')
    seen.add(name)
    const description = text(change.description, 2_000)
    const displayLabel = text(change.displayLabel, 80)
    if (!description || !displayLabel) throw new Error('工具介绍和前端名称不能为空')
    return { name, description, displayLabel }
  })

  updateToolCatalogOverrides(current => {
    const next = { ...current }
    for (const change of changes) {
      const definition = definitions.get(change.name)!
      const defaultDisplayLabel = TOOL_DISPLAY_LABELS[change.name] || change.name
      const override = {
        ...(change.description === definition.description ? {} : { description: change.description }),
        ...(change.displayLabel === defaultDisplayLabel ? {} : { displayLabel: change.displayLabel }),
      }
      if (Object.keys(override).length) next[change.name] = override
      else delete next[change.name]
    }
    return next
  })
  return toolCatalogSnapshot()
}
