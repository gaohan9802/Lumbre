import assert from 'node:assert/strict'
import test from 'node:test'
import { presentAssistantBlocks } from '../../src/lib/chat-bubble-rules'

test('blank lines split bubbles while single newlines and fenced code stay together', () => {
  const blocks: any[] = [{ type: 'text', content: '第一行\n第二行\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n最后一泡' }]
  const shown = presentAssistantBlocks(blocks)
  assert.deepEqual(shown.map(block => block.content), [
    '第一行\n第二行',
    '```ts\nconst a = 1\n\nconst b = 2\n```',
    '最后一泡',
  ])
  assert.ok(shown.every(block => block.presentation === 'bubble'))
})

test('only a single pure action becomes transparent and wrappers never leak', () => {
  const action = presentAssistantBlocks([{ type: 'text', content: '*尾巴轻轻扫过你的手腕。*' }])
  assert.deepEqual(action, [{ type: 'text', content: '尾巴轻轻扫过你的手腕。', presentation: 'action' }])

  const long = presentAssistantBlocks([{ type: 'text', content: '*他低下头。*\n\n**过来。**' }])
  assert.deepEqual(long, [
    { type: 'text', content: '他低下头。', presentation: 'bubble' },
    { type: 'text', content: '过来。', presentation: 'bubble' },
  ])
})

test('wake replies remain one normal bubble', () => {
  const shown = presentAssistantBlocks([{ type: 'text', content: '*醒来了。*\n\n今天也在。' }], { split: false, allowTransparentAction: false })
  assert.deepEqual(shown, [{ type: 'text', content: '*醒来了。*\n\n今天也在。', presentation: 'bubble' }])
})

