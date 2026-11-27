import type { ToolPolicySpec } from '../types'
import { ALL_SAFE_SOURCES } from './shared'

export const LIFE_TOOL_POLICIES: ToolPolicySpec[] = [
  { name: 'read_todo', domain: 'todo', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'add_todo', domain: 'todo', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'edit_todo', domain: 'todo', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'remove_todo', domain: 'todo', level: 'red', allowedSources: ALL_SAFE_SOURCES, confirmationLabel: '删除待办' },
  { name: 'comment_todo', domain: 'todo', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },

  { name: 'wake_me', domain: 'wake', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'update_period', domain: 'period', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'read_period', domain: 'period', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'read_health_summary', domain: 'health', level: 'green', allowedSources: ALL_SAFE_SOURCES },

  { name: 'read_bookmarks', domain: 'bookmarks', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'add_bookmark', domain: 'bookmarks', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'edit_bookmark', domain: 'bookmarks', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },

  { name: 'bite_otter_nape', domain: 'wake', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'read_media_library', domain: 'media', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'save_media_entry', domain: 'media', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'read_coread_text', domain: 'media', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'write_coread_annotation', domain: 'media', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'update_coread_progress', domain: 'media', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'write_media_note', domain: 'media', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'comment_media_event', domain: 'media', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'delete_media_content', domain: 'media', level: 'red', allowedSources: ALL_SAFE_SOURCES, confirmationLabel: '删除书影内容' },
  { name: 'write_opening_message', domain: 'context', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'clear_opening_message', domain: 'context', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
]
