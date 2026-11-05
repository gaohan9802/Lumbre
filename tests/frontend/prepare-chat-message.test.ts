import assert from 'node:assert/strict'
import test from 'node:test'
import type { ChatMessage } from '../../src/features/chat/state/types'
import { prepareChatMessage } from '../../src/features/chat/view/prepareChatMessage'

test('prepared historical messages are reused until the message object changes', () => {
  const original = {
    id: 'message-1', role: 'assistant', replyMode: 'long', content: '正文', timestamp: 1,
    content_blocks: [{ type: 'thinking', content: '想法' }, { type: 'text', content: '正文' }],
  } as ChatMessage

  const first = prepareChatMessage(original)
  assert.equal(prepareChatMessage(original), first)
  assert.deepEqual(first.thinkingParts, ['想法'])
  assert.equal(first.displayContentBlocks?.[1].presentation, 'bubble')

  const updated = prepareChatMessage({ ...original, content_blocks: [{ type: 'text', content: '新正文' }] })
  assert.notEqual(updated, first)
  assert.equal(updated.displayContentBlocks?.[0].content, '新正文')
})

test('prepared replies and wake messages keep their natural paragraphs whole', () => {
  const reply = prepareChatMessage({ id: 'reply', role: 'assistant', content: '第一行\n第二行\n\n第三行', timestamp: 1 } as ChatMessage)
  assert.deepEqual(reply.displayContentBlocks?.map(block => block.content), ['第一行\n第二行\n\n第三行'])

  const wake = prepareChatMessage({ id: 'wake', role: 'assistant', content: '第一行\n\n第二行', timestamp: 1, _wake: true } as ChatMessage & { _wake: true })
  assert.deepEqual(wake.displayContentBlocks?.map(block => block.content), ['第一行\n\n第二行'])
})
