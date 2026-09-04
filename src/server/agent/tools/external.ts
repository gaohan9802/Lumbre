import type { ToolPolicySpec } from '../types'
import { ALL_SAFE_SOURCES, CHAT_SOURCES } from './shared'

export const EXTERNAL_TOOL_POLICIES: ToolPolicySpec[] = [
  { name: 'gmail_status', domain: 'mail', level: 'green', allowedSources: CHAT_SOURCES },
  { name: 'send_email', domain: 'mail', level: 'red', allowedSources: CHAT_SOURCES, confirmationLabel: '发送邮件' },
  { name: 'read_emails', domain: 'mail', level: 'green', allowedSources: CHAT_SOURCES },
  { name: 'search_emails', domain: 'mail', level: 'green', allowedSources: CHAT_SOURCES },
  { name: 'read_email_detail', domain: 'mail', level: 'green', allowedSources: CHAT_SOURCES },
  { name: 'reply_email', domain: 'mail', level: 'red', allowedSources: CHAT_SOURCES, confirmationLabel: '回复邮件' },

  { name: 'fetch_txt', domain: 'web', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'fetch_markdown', domain: 'web', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'fetch_html', domain: 'web', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'fetch_json', domain: 'web', level: 'green', allowedSources: ALL_SAFE_SOURCES },
]
