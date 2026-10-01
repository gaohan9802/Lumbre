import assert from 'node:assert/strict'
import test from 'node:test'
import { TOOL_DISPLAY_LABELS, toolDisplayLabel } from '../../src/features/chat/tool-display'

test('every Lumbre tool has one fixed display label with a safe fallback', () => {
  assert.equal(Object.keys(TOOL_DISPLAY_LABELS).length, 79)
  assert.equal(toolDisplayLabel('read_notes'), '翻了翻纸条')
  assert.equal(toolDisplayLabel('get_location'), '查了查水獭位置')
  assert.equal(toolDisplayLabel('read_health_summary'), '看了看小火的健康状态')
  assert.equal(toolDisplayLabel('future_tool'), 'future_tool')
})
