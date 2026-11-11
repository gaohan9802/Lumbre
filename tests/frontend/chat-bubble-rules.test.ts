import assert from 'node:assert/strict'
import test from 'node:test'
import { presentAssistantBlocks } from '../../src/lib/chat-bubble-rules'

test('long replies keep natural paragraphs inside one text block', () => {
  const blocks: any[] = [{ type: 'text', content: '第一行\n第二行\n\n```ts\nconst a = 1\n\nconst b = 2\n```\n\n最后一泡' }]
  const shown = presentAssistantBlocks(blocks, { split: false })
  assert.deepEqual(shown.map(block => block.content), [blocks[0].content])
  assert.ok(shown.every(block => block.presentation === 'bubble'))
})

test('only a single pure action becomes transparent and wrappers never leak', () => {
  const action = presentAssistantBlocks([{ type: 'text', content: '*尾巴轻轻扫过你的手腕。*' }], { split: false })
  assert.deepEqual(action, [{ type: 'text', content: '尾巴轻轻扫过你的手腕。', presentation: 'action' }])

  const mixed = '*他低下头。*\n\n**过来。**'
  const long = presentAssistantBlocks([{ type: 'text', content: mixed }], { split: false })
  assert.deepEqual(long, [{ type: 'text', content: mixed, presentation: 'bubble' }])

  const streaming = presentAssistantBlocks([{ type: 'text', content: `${mixed}\n\n我在这里。` }], { split: false, streaming: true })
  assert.deepEqual(streaming, [{ type: 'text', content: `${mixed}\n\n我在这里。`, presentation: 'bubble' }])
})

test('wake replies remain one normal bubble', () => {
  const shown = presentAssistantBlocks([{ type: 'text', content: '*醒来了。*\n\n今天也在。' }], { split: false, allowTransparentAction: false })
  assert.deepEqual(shown, [{ type: 'text', content: '*醒来了。*\n\n今天也在。', presentation: 'bubble' }])
})

