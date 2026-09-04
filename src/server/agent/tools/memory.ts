import type { ToolPolicySpec } from '../types'
import { ALL_SAFE_SOURCES } from './shared'

export const MEMORY_TOOL_POLICIES: ToolPolicySpec[] = [
  { name: 'breath', domain: 'memory', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'hold', domain: 'memory', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'grow', domain: 'memory', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  {
    name: 'trace', domain: 'memory', level: 'yellow', allowedSources: ALL_SAFE_SOURCES,
    confirmationLabel: '删除记忆',
    resolveLevel: input => input.delete === true ? 'red' : 'yellow',
  },
  { name: 'pulse', domain: 'memory', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'dream', domain: 'memory', level: 'green', allowedSources: ALL_SAFE_SOURCES },
]
