import type { ToolPolicySpec } from '../types'
import { ALL_SAFE_SOURCES, CHAT_SOURCES } from './shared'

export const LIFE_TOOL_POLICIES: ToolPolicySpec[] = [
  { name: 'write_timeline_encouragements', domain: 'timeline', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'read_timeline_encouragements', domain: 'timeline', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'edit_timeline_encouragement', domain: 'timeline', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'delete_timeline_encouragement', domain: 'timeline', level: 'red', allowedSources: CHAT_SOURCES, confirmationLabel: '删除鼓励话' },
  { name: 'read_life_timeline', domain: 'timeline', level: 'green', allowedSources: ALL_SAFE_SOURCES },

  { name: 'read_todo', domain: 'todo', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'add_todo', domain: 'todo', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'edit_todo', domain: 'todo', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'remove_todo', domain: 'todo', level: 'red', allowedSources: CHAT_SOURCES, confirmationLabel: '删除待办' },
  { name: 'comment_todo', domain: 'todo', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },

  { name: 'read_thesis', domain: 'thesis', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'comment_thesis', domain: 'thesis', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },

  { name: 'view_wish', domain: 'wishes', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'write_wish', domain: 'wishes', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'edit_wish', domain: 'wishes', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'delete_wish', domain: 'wishes', level: 'red', allowedSources: CHAT_SOURCES, confirmationLabel: '删除愿望' },
  { name: 'like_wish', domain: 'wishes', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'comment_wish', domain: 'wishes', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },

  { name: 'wake_me', domain: 'wake', level: 'yellow', allowedSources: ALL_SAFE_SOURCES },
  { name: 'get_weather', domain: 'context', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'get_location', domain: 'context', level: 'green', allowedSources: CHAT_SOURCES },
  { name: 'update_period', domain: 'period', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'read_period', domain: 'period', level: 'green', allowedSources: ALL_SAFE_SOURCES },

  { name: 'read_bookmarks', domain: 'bookmarks', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'add_bookmark', domain: 'bookmarks', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'edit_bookmark', domain: 'bookmarks', level: 'yellow', allowedSources: CHAT_SOURCES },

  { name: 'read_coupons', domain: 'coupons', level: 'green', allowedSources: ALL_SAFE_SOURCES },
  { name: 'create_coupon', domain: 'coupons', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'sign_coupon', domain: 'coupons', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'edit_coupon', domain: 'coupons', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'use_coupon', domain: 'coupons', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'void_coupon', domain: 'coupons', level: 'yellow', allowedSources: CHAT_SOURCES },
  { name: 'confirm_void_coupon', domain: 'coupons', level: 'red', allowedSources: CHAT_SOURCES, confirmationLabel: '作废券' },
]
