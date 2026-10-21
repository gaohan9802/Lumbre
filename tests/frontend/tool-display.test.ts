import assert from 'node:assert/strict'
import test from 'node:test'
import { TOOL_DISPLAY_LABELS, toolDisplayLabel } from '../../src/features/chat/tool-display'

test('every Lumbre tool has one fixed display label with a safe fallback', () => {
  assert.equal(Object.keys(TOOL_DISPLAY_LABELS).length, 113)
  assert.equal(toolDisplayLabel('read_notes'), '翻了翻纸条')
  assert.equal(toolDisplayLabel('get_location'), '查了查水獭位置')
  assert.equal(toolDisplayLabel('read_health_summary'), '看了看小火的健康状态')
  assert.equal(toolDisplayLabel('read_guestbook'), '翻开了告状簿')
  assert.equal(toolDisplayLabel('reply_guestbook'), '在告状簿回了句话')
  assert.equal(toolDisplayLabel('save_chat_foto'), '收藏了一张照片')
  assert.equal(toolDisplayLabel('write_travel_journal'), '续写了旅行日记')
  assert.equal(toolDisplayLabel('draw_picture'), '在小画室画画')
  assert.equal(toolDisplayLabel('log_energy_intake'), '记下了小火的吃喝')
  assert.equal(toolDisplayLabel('save_energy_goal'), '写下了今天的健康目标')
  assert.equal(toolDisplayLabel('save_grocery_item'), '写好了下次买菜清单')
  assert.equal(toolDisplayLabel('write_opening_message'), '换了一句开屏语')
  assert.equal(toolDisplayLabel('clear_opening_message'), '收起了开屏语')
  assert.equal(toolDisplayLabel('read_future_letter'), '读了读写给未来的信')
  assert.equal(toolDisplayLabel('append_future_letter'), '给未来的自己添了一段话')
  assert.equal(toolDisplayLabel('edit_future_letter_paragraph'), '改了写给未来的一段话')
  assert.equal(toolDisplayLabel('future_tool'), 'future_tool')
})
