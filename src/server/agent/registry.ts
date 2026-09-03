import { executeToolLegacy } from '@/server/tool-runtime'
import { TOOL_DEFINITIONS } from './definitions'
import { EXTERNAL_TOOL_POLICIES } from './tools/external'
import { JOURNAL_TOOL_POLICIES } from './tools/journal'
import { LIFE_TOOL_POLICIES } from './tools/life'
import { MEMORY_TOOL_POLICIES } from './tools/memory'
import type { RegisteredTool, ToolDef, ToolPolicySpec } from './types'
import type { ToolCallContext } from './context'
import { evaluateToolPolicy } from './policy'

const POLICIES: ToolPolicySpec[] = [
  ...MEMORY_TOOL_POLICIES,
  ...JOURNAL_TOOL_POLICIES,
  ...LIFE_TOOL_POLICIES,
  ...EXTERNAL_TOOL_POLICIES,
]

function buildRegistry(): Map<string, RegisteredTool> {
  const definitions = new Map(TOOL_DEFINITIONS.map(definition => [definition.name, definition]))
  const registry = new Map<string, RegisteredTool>()

  for (const policy of POLICIES) {
    if (registry.has(policy.name)) throw new Error(`Duplicate tool policy: ${policy.name}`)
    const definition = definitions.get(policy.name)
    if (!definition) throw new Error(`Missing tool definition: ${policy.name}`)
    registry.set(policy.name, {
      ...policy,
      definition,
      execute: input => executeToolLegacy(policy.name, input),
    })
  }

  const unregistered = Array.from(definitions.keys()).filter(name => !registry.has(name))
  if (unregistered.length) throw new Error(`Tools missing policy metadata: ${unregistered.join(', ')}`)
  return registry
}

const REGISTRY = buildRegistry()
const ORDERED_REGISTRY = TOOL_DEFINITIONS.map(definition => {
  const tool = REGISTRY.get(definition.name)
  if (!tool) throw new Error(`Missing registered tool: ${definition.name}`)
  return tool
})

export const ALL_TOOLS: ToolDef[] = ORDERED_REGISTRY.map(tool => tool.definition)
export const FETCH_TOOL_NAMES = new Set(['fetch_txt', 'fetch_markdown', 'fetch_html', 'fetch_json'])

export function getRegisteredTool(name: string): RegisteredTool | undefined {
  return REGISTRY.get(name)
}

export function toolsForContext(context: ToolCallContext): ToolDef[] {
  return ORDERED_REGISTRY
    .filter(tool => {
      const decision = evaluateToolPolicy(tool, {}, context)
      return decision.allowed || decision.requiresConfirmation
    })
    .map(tool => {
      let definition = tool.definition
      if (context.source === 'unattended-wake' && tool.name === 'trace') {
        const { delete: _delete, ...properties } = definition.input_schema.properties
        definition = {
          ...definition,
          description: definition.description.replace(/,delete=True删除。?/, '。'),
          input_schema: { ...definition.input_schema, properties },
        }
      }
      const redNote = tool.level === 'red'
        ? '（红色操作：执行前会弹出确认，只有当前用户明确同意才会生效。）'
        : tool.resolveLevel
          ? '（其中删除属于红色操作，执行前需要当前用户明确确认。）'
          : ''
      return redNote ? { ...definition, description: `${definition.description}${redNote}` } : definition
    })
}

export function registeredToolCount(): number {
  return REGISTRY.size
}

export type { ToolDef } from './types'
