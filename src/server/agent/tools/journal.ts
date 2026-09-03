import type { ToolPolicySpec } from '../types'
import { ALL_SAFE_SOURCES, CHAT_SOURCES } from './shared'

export const JOURNAL_TOOL_POLICIES: ToolPolicySpec[] = [
  { name: 'write_diary', domain: 'diary', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'read_diary', domain: 'diary', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'comment_diary', domain: 'diary', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'update_diary', domain: 'diary', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'delete_diary', domain: 'diary', level: 'red', allowedSources: CHAT_SOURCES, confirmationLabel: '删除日记' },
  { name: 'unlock_diary', domain: 'diary', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'set_password', domain: 'diary', level: 'red', allowedSources: CHAT_SOURCES, confirmationLabel: '修改日记密码' },
  { name: 'timeline', domain: 'diary', level: 'green', allowedSources: ALL_SAFE_SOURCES },

  { name: 'write_note', domain: 'notes', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'read_notes', domain: 'notes', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'reply_note', domain: 'notes', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'delete_note', domain: 'notes', level: 'red', allowedSources: CHAT_SOURCES, confirmationLabel: '删除纸条' },

  { name: 'read_foto', domain: 'photos', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'view_foto', domain: 'photos', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'edit_foto', domain: 'photos', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'delete_foto', domain: 'photos', level: 'red', allowedSources: CHAT_SOURCES, confirmationLabel: '删除照片' },
  { name: 'comment_foto', domain: 'photos', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
]
