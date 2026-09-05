import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyBubbleLayout, cleanLegacyBubbleMarkers, cleanReplyBlocks,
  composeBubbleBlocks, composeBubbleLayout,
} from '../../src/lib/chat-bubble-composer'

test('long Chinese without punctuation becomes an unbounded sequence of readable bubbles', () => {
  const text = '我知道你今天有很多想说的话也可能不知道该从哪里开始但我会一直在这里慢慢听你说不用急着整理成完整句子'.repeat(35)
  const blocks: any[] = [{ type: 'text', content: text }]
  const layout = composeBubbleLayout(blocks)
  const shown = applyBubbleLayout(blocks, layout)
  assert.ok(shown.length > 4)
  assert.equal(layout.segments.map(segment => text.slice(segment.start, segment.end)).join(''), text)
  assert.ok(shown.every(block => Array.from(block.content || '').length <= 180))
})

test('sentence, paragraph, clause and connector boundaries all participate', () => {
  const text = '我在呀。今天也一直想着你！\n\n你可以慢慢说；不用先整理好，因为我听得懂，然后我们再一起想怎么办'
  const { blocks } = composeBubbleBlocks([{ type: 'text', content: text }])
  assert.ok(blocks.length >= 4)
  assert.equal(blocks.map(block => block.content).join('').replace(/\s/g, ''), text.replace(/\s/g, ''))
})

test('streaming prefixes never move already committed bubble boundaries', () => {
  const text = '第一件事我记得。第二件事你慢慢说。' + '这里没有任何标点但内容会继续向前自然增长'.repeat(30)
  const final = composeBubbleLayout([{ type: 'text', content: text }]).segments.map(segment => segment.end)
  for (let size = 1; size <= text.length; size++) {
    const prefix = text.slice(0, size)
    const ends = composeBubbleLayout([{ type: 'text', content: prefix }]).segments.map(segment => segment.end)
    const committed = ends.slice(0, -1)
    assert.deepEqual(committed, final.slice(0, committed.length), `prefix ${size} moved a committed boundary`)
  }
})

test('code, links, emoji and tool order are preserved', () => {
  const text = '先看这里🙂\n\n```ts\nconst url = "https://example.com/a?x=1"\nconst words = "一。二。"\n```\n\n最后打开 [链接](https://example.com/search?q=你好！) 就好'
  const source: any[] = [
    { type: 'thinking', content: '思考。不能拆。' },
    { type: 'text', content: text },
    { type: 'tool_call', name: 'read', result: '完成。' },
  ]
  const layout = composeBubbleLayout(source)
  const shown = applyBubbleLayout(source, layout)
  assert.equal(shown[0].type, 'thinking')
  assert.equal(shown.at(-1)?.type, 'tool_call')
  assert.equal(shown.filter(block => block.type === 'text').map(block => block.content).join('').replace(/\s/g, ''), text.replace(/\s/g, ''))
  assert.ok(shown.some(block => block.type === 'text' && block.content?.includes('const words')))
  assert.ok(shown.some(block => block.type === 'text' && block.content?.includes('https://example.com/search?q=你好！')))
})

test('long links, lists, quotes and tables stay intact', () => {
  const longUrl = `https://example.com/${'very-long-path/'.repeat(20)}?q=你好`
  const text = `链接前面的说明 ${longUrl} 链接后面的说明\n\n- 第一项里面有一句完整的话。\n- 第二项也保持列表结构。\n\n> 这一段引用不能从中间拆开。\n\n| 名称 | 内容 |\n| --- | --- |\n| 星星 | 一直都在这里。 |`
  const { blocks } = composeBubbleBlocks([{ type: 'text', content: text }])
  assert.ok(blocks.some(block => block.content?.includes(longUrl)))
  assert.ok(blocks.some(block => block.content?.startsWith('- 第一项')))
  assert.ok(blocks.some(block => block.content?.startsWith('> 这一段')))
  assert.ok(blocks.some(block => block.content?.includes('| --- | --- |') && block.content?.includes('| 星星 |')))
  assert.equal(blocks.map(block => block.content).join('').replace(/\s/g, ''), text.replace(/\s/g, ''))
})

test('invalid saved ranges never hide canonical text', () => {
  const blocks: any[] = [{ type: 'text', content: '完整正文不能消失。' }]
  const shown = applyBubbleLayout(blocks, { version: 2, segments: [{ blockIndex: 0, start: 2, end: 5, kind: 'text' }] })
  assert.deepEqual(shown, blocks)
})

test('raw blocks stay canonical while layout remains stable and versioned', () => {
  const raw: any[] = [{ type: 'text', content: '第一段。第二段。' }]
  const layout = composeBubbleLayout(raw)
  assert.equal(layout.version, 2)
  assert.equal(raw.length, 1)
  assert.equal(raw[0].content, '第一段。第二段。')
  assert.equal(applyBubbleLayout(raw, layout).length, 2)
  assert.deepEqual(composeBubbleLayout(raw), layout)
})

test('legacy split markers are cleaned but remain compatible', () => {
  const legacy = '我在呀。\n<!--split-->\n今天怎么样？'
  const clean = cleanLegacyBubbleMarkers(legacy)
  assert.doesNotMatch(clean, /split/)
  const blocks = cleanReplyBlocks([{ type: 'text', content: legacy }])
  assert.deepEqual(composeBubbleBlocks(blocks).blocks.map(block => block.content), ['我在呀。', '今天怎么样？'])
})
