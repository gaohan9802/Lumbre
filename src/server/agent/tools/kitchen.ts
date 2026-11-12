import type { ToolPolicySpec } from '../types'
import { ALL_SAFE_SOURCES } from './shared'

export const KITCHEN_TOOL_POLICIES: ToolPolicySpec[] = [
  { name: 'kitchen_cook', domain: 'kitchen', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'kitchen_status', domain: 'kitchen', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'kitchen_cancel', domain: 'kitchen', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'kitchen_toss', domain: 'kitchen', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'kitchen_buy', domain: 'kitchen', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'eat', domain: 'kitchen', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'read_menu', domain: 'kitchen', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'snack_eat', domain: 'kitchen', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'kitchen_notes', domain: 'kitchen', level: 'green', allowedSources: ALL_SAFE_SOURCES },
]
