import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-creative-stores-'))
process.env.DATA_DIR = root

let poems: typeof import('../../src/server/poem-store')
let wheel: typeof import('../../src/server/intimacy-wheel-store')
let stories: typeof import('../../src/server/story-store')
let research: typeof import('../../src/server/research-store')
let runtime: typeof import('../../src/server/tool-runtime')

before(async () => {
  poems = await import('../../src/server/poem-store')
  wheel = await import('../../src/server/intimacy-wheel-store')
  stories = await import('../../src/server/story-store')
  research = await import('../../src/server/research-store')
  runtime = await import('../../src/server/tool-runtime')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('共诗严格交替并保留编辑历史', () => {
  const poem = poems.createPoem('两个人的诗')
  poems.appendPoemLine(poem.id, 'fire', '第一句')
  assert.throws(() => poems.appendPoemLine(poem.id, 'fire', '抢写'), /星星/)
  const withStar = poems.appendPoemLine(poem.id, 'star', '第二句')
  const line = withStar.lines[1]
  poems.editPoemLine(poem.id, line.id, 'star', '第二句，改过')
  assert.equal(poems.getPoem(poem.id).lines[1].versions.length, 2)
  assert.equal(existsSync(path.join(root, 'poems', 'poems.json.bak')), true)
})

test('转盘只抽启用元素并保留最近三十次', () => {
  const state = wheel.readWheel()
  const pool = state.pools[0]
  for (const option of pool.options) wheel.editWheelOption(pool.id, option.id, { enabled: false })
  const only = wheel.addWheelOption(pool.id, '唯一结果', 'star')
  assert.equal(wheel.spinWheel('star', [pool.id]).results[0].option_id, only.id)
  for (let index = 0; index < 35; index += 1) wheel.spinWheel('fire', [pool.id])
  assert.equal(wheel.readWheel().recent.length, 30)
})

test('长故事分段落盘并在完成前保持草稿', () => {
  const story = stories.createStory('月下列车', 'moonlight')
  const first = stories.appendStorySection(story.id, '第一段')
  stories.appendStorySection(story.id, '第二段')
  assert.equal(first.story.status, 'draft')
  assert.equal(stories.getStory(story.id).sections.length, 2)
  assert.equal(stories.updateStory(story.id, { status: 'complete' }).status, 'complete')
  assert.equal(stories.updateStorySection(story.id, first.section.id, '改过的第一段').sections[0].text, '改过的第一段')
  assert.equal(existsSync(path.join(root, 'stories', 'stories.json.bak')), true)
})

test('星野手记按领域、标签、课题和记录生长', () => {
  const field = research.createResearch('field', { name: '天文', description: '看很远的光' }) as any
  const tag = research.createResearch('tag', { field_id: field.id, name: '恒星' }) as any
  const topic = research.createResearch('topic', { field_id: field.id, tag_ids: [tag.id], title: '红巨星会发生什么？' }) as any
  const entry = research.createResearch('entry', { topic_id: topic.id, entry_kind: 'thought', content: '先记下一个猜想。' }) as any
  assert.equal(research.readResearchTopic(topic.id).entries[0].id, entry.id)
  research.setResearchArchived('entry', entry.id, true)
  assert.equal(research.readResearchTopic(topic.id).entries.length, 0)
  research.setResearchArchived('entry', entry.id, false)
  assert.equal(research.researchOverview().topics[0].entry_count, 1)
})

test('星星工具分段写故事并只返回紧凑收据', async () => {
  const createInput = { action: 'create', title: '工具故事', shelf: 'undertow', story_key: 'tool-story-fixture' }
  const created = JSON.parse(await runtime.executeRegisteredToolHandler('write_story', createInput))
  const repeatedCreate = JSON.parse(await runtime.executeRegisteredToolHandler('write_story', createInput))
  const appendInput = { action: 'append', id: created.id, text: '保存下来的一段。', chunk_key: 'part-1' }
  const appended = JSON.parse(await runtime.executeRegisteredToolHandler('write_story', appendInput))
  const repeatedAppend = JSON.parse(await runtime.executeRegisteredToolHandler('write_story', appendInput))
  const finished = JSON.parse(await runtime.executeRegisteredToolHandler('write_story', { action: 'finish', id: created.id }))
  assert.equal(repeatedCreate.id, created.id)
  assert.equal(appended.saved_chars, 8)
  assert.equal(repeatedAppend.deduplicated, true)
  assert.equal(stories.getStory(created.id).sections.length, 1)
  assert.equal(finished.status, 'complete')
  assert.equal('sections' in finished, false)
})
