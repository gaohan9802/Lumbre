import type { ToolPolicySpec } from '../types'
import { ALL_SAFE_SOURCES } from './shared'

export const ENGAWA_TOOL_POLICIES: ToolPolicySpec[] = [
  ...['web_read', 'rss_read', 'shelf', 'shelf_suggest', 'sky_tonight', 'apod', 'daily_art', 'arxiv_new', 'daily_poem', 'on_this_day', 'hobby_corner']
    .map(name => ({ name, domain: 'engawa' as const, level: 'green' as const, allowedSources: ALL_SAFE_SOURCES })),
  ...['shelf_add', 'hobby_add', 'write_windowsill_line']
    .map(name => ({ name, domain: 'engawa' as const, level: 'yellow' as const, allowedSources: ALL_SAFE_SOURCES })),
  { name: 'shelf_remove', domain: 'engawa', level: 'red', allowedSources: ALL_SAFE_SOURCES, confirmationLabel: '移除窗台书架来源' },
  { name: 'hobby_remove', domain: 'engawa', level: 'red', allowedSources: ALL_SAFE_SOURCES, confirmationLabel: '移除窗台爱好主题' },
]
