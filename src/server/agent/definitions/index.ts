import { EXTERNAL_TOOL_DEFINITIONS } from './external'
import { JOURNAL_TOOL_DEFINITIONS } from './journal'
import { LIFE_TOOL_DEFINITIONS } from './life'
import { MEMORY_TOOL_DEFINITIONS } from './memory'

const DEFINITIONS = [
  ...MEMORY_TOOL_DEFINITIONS,
  ...JOURNAL_TOOL_DEFINITIONS,
  ...LIFE_TOOL_DEFINITIONS,
  ...EXTERNAL_TOOL_DEFINITIONS,
]

// Keep the pre-refactor order stable because tool schema order participates in
// provider prompt caching even though names and schemas are otherwise identical.
const TOOL_ORDER = [
  'breath', 'hold', 'grow', 'trace', 'pulse', 'dream',
  'write_diary', 'read_diary', 'comment_diary', 'update_diary', 'delete_diary', 'unlock_diary', 'set_password', 'timeline',
  'write_note', 'read_notes', 'reply_note', 'delete_note',
  'read_foto', 'view_foto', 'edit_foto', 'delete_foto', 'comment_foto',
  'write_timeline_encouragements', 'read_timeline_encouragements', 'edit_timeline_encouragement', 'delete_timeline_encouragement', 'read_life_timeline',
  'read_todo', 'add_todo', 'edit_todo', 'remove_todo', 'comment_todo',
  'read_thesis', 'comment_thesis',
  'view_wish', 'write_wish', 'edit_wish', 'delete_wish', 'like_wish', 'comment_wish',
  'wake_me',
  'fetch_txt', 'fetch_markdown', 'fetch_html', 'fetch_json',
  'get_weather', 'get_location',
  'update_period', 'read_period',
  'gmail_status', 'send_email', 'read_emails', 'search_emails', 'read_email_detail', 'reply_email',
  'read_bookmarks', 'add_bookmark', 'edit_bookmark',
  'read_coupons', 'create_coupon', 'sign_coupon', 'edit_coupon', 'use_coupon', 'void_coupon', 'confirm_void_coupon',
] as const

const byName = new Map(DEFINITIONS.map(definition => [definition.name, definition]))
export const TOOL_DEFINITIONS = TOOL_ORDER.map(name => {
  const definition = byName.get(name)
  if (!definition) throw new Error(`Missing tool definition in catalog: ${name}`)
  return definition
})
