import type { ToolPolicySpec } from '../types'
import { ALL_SAFE_SOURCES, CHAT_SOURCES } from './shared'

export const CREATIVE_TOOL_POLICIES: ToolPolicySpec[] = [
  { name: 'read_poems', domain: 'poems', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  {
    name: 'write_poem', domain: 'poems', level: 'yellow', allowedSources: CHAT_SOURCES,
    resolveLevel: input => ['delete', 'delete_line'].includes(input.action) ? 'red' : 'yellow',
  },
  { name: 'read_intimacy_wheel', domain: 'intimacy-wheel', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  {
    name: 'update_intimacy_wheel', domain: 'intimacy-wheel', level: 'yellow', allowedSources: CHAT_SOURCES,
    resolveLevel: input => input.action === 'delete' ? 'red' : 'yellow',
  },
]
