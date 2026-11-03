import type { ToolDomain, ToolRiskLevel } from '@/server/agent/types'

export interface ToolCatalogItem {
  name: string
  domain: ToolDomain
  risk: ToolRiskLevel
  conditionalRisk: boolean
  description: string
  defaultDescription: string
  displayLabel: string
  defaultDisplayLabel: string
  customizedDescription: boolean
  customizedDisplayLabel: boolean
}

export interface ToolCatalogSnapshot {
  tools: ToolCatalogItem[]
}

export interface ToolCatalogChange {
  name: string
  description: string
  displayLabel: string
}
