export const TOOL_DISPLAY_LABELS: Record<string, string> = {
  breath: '找了找记忆',
  hold: '收好了一段记忆',
  grow: '整理了记忆',
  trace: '整理了记忆',
  pulse: '看了看记忆状态',
  dream: '看看最近有什么记忆',
  recall_memory: '回想了记忆',
  remember: '记住了一件事',
  review_memory: '整理了待审记忆',
  lock_memory: '锁好了记忆',
  manage_formal_memory: '整理了正式记忆',
  manage_memory_family: '整理了记忆家族',
  write_diary: '写了日记',
  read_diary: '读了日记',
  comment_diary: '评论了日记',
  update_diary: '修改了日记',
  delete_diary: '删除了日记',
  unlock_diary: '解锁了秘密日记',
  set_password: '修改了日记密码',
  timeline: '翻看了日记时间线',
  read_guestbook: '翻开了告状簿',
  write_guestbook: '在告状簿贴了张纸条',
  reply_guestbook: '在告状簿回了句话',
  delete_guestbook_message: '撕掉了自己的告状纸',
  write_opening_message: '换了一句开屏语',
  clear_opening_message: '收起了开屏语',
  read_future_letter: '读了读写给未来的信',
  append_future_letter: '给未来的自己添了一段话',
  edit_future_letter_paragraph: '改了写给未来的一段话',
  read_fire_dictionary: '翻了翻小火辞典',
  create_fire_dictionary_entry: '记下了一个小火词',
  update_fire_dictionary_entry: '重新解释了一个词',
  delete_fire_dictionary_entry: '划掉了一个旧词条',
  search_summaries: '查了查摘要档案',
  read_summary: '读了一张摘要',
  list_foto_albums: '翻了翻相册',
  read_foto: '逛了逛照片墙',
  view_foto: '仔细看了张照片',
  save_chat_foto: '收藏了一张照片',
  edit_foto: '修改了照片说明',
  delete_foto: '删掉了一张照片',
  comment_foto: '评论了一张照片',
  read_travel_journal: '翻了翻旅行日记',
  write_travel_journal: '续写了旅行日记',
  draw_picture: '在小画室画画',
  read_todo: '检查了水獭待办',
  add_todo: '加了一项待办',
  edit_todo: '修改了待办',
  remove_todo: '删除了待办',
  comment_todo: '点评了待办',
  read_thesis: '查看了论文进度',
  comment_thesis: '评论了论文进度',
  wake_me: '定了个闹钟',
  search_web: '网上冲浪',
  fetch_txt: '阅读了文本',
  fetch_markdown: '阅读了文章',
  fetch_html: '阅读了网页',
  fetch_json: '阅读了数据',
  update_period: '记下了小水獭的经期',
  read_period: '查看了小水獭经期状态',
  read_health_summary: '看了看小火的健康状态',
  read_bookmarks: '翻了翻书签',
  add_bookmark: '收进了书签',
  edit_bookmark: '修改了书签',
  read_poems: '翻开了诗集',
  write_poem: '续写了一首诗',
  read_intimacy_wheel: '看看今天怎么操',
  update_intimacy_wheel: '往转盘里扔了点元素',
  read_stories: '翻开了枕边集',
  write_story: '写了一个故事',
  read_study_notebook: '翻看了小书桌',
  respond_study_notebook: '在小书桌添了一笔',
  bite_otter_nape: '咬一口小水獭的后颈',
  read_media_library: '翻了翻我们的书影记录',
  save_media_entry: '更新了书影记录',
  read_coread_text: '翻开了我们的共读书',
  write_coread_annotation: '在共读书里留下了批注',
  update_coread_progress: '记住了共读位置',
  write_media_note: '写下了一则书影笔记',
  comment_media_event: '回应了一条书影动态',
  delete_media_content: '删除了自己的书影内容',
  cedar_list_games: '在游戏厅逛了逛',
  cedar_get_guide: '翻开了玩法说明',
  cedar_play: '玩了一回合',
  cedar_account: '整理了游戏存档',
  nursery: '去看了看孩子',
}

let toolDisplayOverrides: Record<string, string> = {}

export function setToolDisplayLabelOverrides(labels: Record<string, string>) {
  toolDisplayOverrides = Object.fromEntries(Object.entries(labels).filter(([name, label]) => name && typeof label === 'string' && label.trim()))
}

export function toolDisplayLabel(name: string): string {
  return toolDisplayOverrides[name] || TOOL_DISPLAY_LABELS[name] || name
}

export function toolDisplayInput(name: string, input: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (name !== 'draw_picture' || !input) return input
  let elements = 0
  try {
    const scene = JSON.parse(String(input.scene_json || '{}'))
    elements = Array.isArray(scene.elements) ? scene.elements.length : 0
  } catch {}
  return { style: input.style, title: input.title, elements }
}
