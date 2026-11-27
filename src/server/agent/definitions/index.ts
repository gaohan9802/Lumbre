import { EXTERNAL_TOOL_DEFINITIONS } from './external'
import { JOURNAL_TOOL_DEFINITIONS } from './journal'
import { LIFE_TOOL_DEFINITIONS } from './life'
import { MEMORY_TOOL_DEFINITIONS } from './memory'
import { CREATIVE_TOOL_DEFINITIONS } from './creative'
import { NURSERY_TOOL_DEFINITIONS } from './nursery'

const DEFINITIONS = [
  ...MEMORY_TOOL_DEFINITIONS,
  ...JOURNAL_TOOL_DEFINITIONS,
  ...LIFE_TOOL_DEFINITIONS,
  ...EXTERNAL_TOOL_DEFINITIONS,
  ...CREATIVE_TOOL_DEFINITIONS,
  ...NURSERY_TOOL_DEFINITIONS,
]

// Keep the pre-refactor order stable because tool schema order participates in
// provider prompt caching even though names and schemas are otherwise identical.
const TOOL_ORDER = [
  'breath', 'hold', 'grow', 'trace', 'pulse', 'dream', 'recall_memory', 'remember', 'review_memory', 'lock_memory', 'manage_formal_memory', 'manage_memory_family',
  'write_diary', 'read_diary', 'comment_diary', 'update_diary', 'delete_diary', 'unlock_diary', 'set_password', 'timeline',
  'list_foto_albums', 'read_foto', 'view_foto', 'save_chat_foto', 'edit_foto', 'delete_foto', 'comment_foto', 'read_travel_journal', 'write_travel_journal',
  'read_todo', 'add_todo', 'edit_todo', 'remove_todo', 'comment_todo',
  'wake_me',
  'search_web', 'fetch_txt', 'fetch_markdown', 'fetch_html', 'fetch_json',
  'update_period', 'read_period', 'read_health_summary',
  'read_bookmarks', 'add_bookmark', 'edit_bookmark',
  'read_poems', 'write_poem', 'read_intimacy_wheel', 'update_intimacy_wheel', 'draw_picture',
  'read_stories', 'write_story', 'read_study_notebook', 'respond_study_notebook',
  'bite_otter_nape',
  'read_media_library', 'save_media_entry', 'read_coread_text', 'write_coread_annotation', 'update_coread_progress', 'write_media_note', 'comment_media_event', 'delete_media_content',
  'read_guestbook', 'write_guestbook', 'reply_guestbook', 'delete_guestbook_message',
  'write_opening_message', 'clear_opening_message',
  'read_future_letter', 'append_future_letter', 'edit_future_letter_paragraph',
  'read_fire_dictionary', 'create_fire_dictionary_entry', 'update_fire_dictionary_entry', 'delete_fire_dictionary_entry',
  'search_summaries', 'read_summary',
  'cedar_list_games', 'cedar_get_guide', 'cedar_play', 'cedar_account',
  'nursery',
] as const

const byName = new Map(DEFINITIONS.map(definition => [definition.name, definition]))
export const TOOL_DEFINITIONS = TOOL_ORDER.map(name => {
  const definition = byName.get(name)
  if (!definition) throw new Error(`Missing tool definition in catalog: ${name}`)
  return definition
})
