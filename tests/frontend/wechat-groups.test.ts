import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatMessage } from '../../src/features/chat/state/types'
import { groupWechatMessages } from '../../src/features/chat/view/wechat-groups'

const message = (id: string, timestamp: number, transport?: 'wechat'): ChatMessage => ({
  id, timestamp, transport, role: id.startsWith('a') ? 'assistant' : 'user', route: 'claude-code', content: id,
})

test('only consecutive nearby WeChat messages fold into a display card', () => {
  const items = groupWechatMessages([
    message('u1', 1_000, 'wechat'), message('a1', 2_000, 'wechat'),
    message('u2', 3_000), message('u3', 4_000, 'wechat'),
  ])
  assert.deepEqual(items.map(item => [item.kind, item.startIndex, item.endIndex]), [
    ['wechat', 0, 1], ['message', 2, 2], ['wechat', 3, 3],
  ])
  assert.equal(items[0].kind === 'wechat' ? items[0].messages.length : 0, 2)
})

test('a long idle gap starts a new WeChat card', () => {
  const items = groupWechatMessages([
    message('u1', 1_000, 'wechat'), message('a1', 31 * 60 * 1000 + 1_000, 'wechat'),
  ])
  assert.equal(items.length, 2)
})
