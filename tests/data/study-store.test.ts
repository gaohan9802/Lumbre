import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-study-'))
process.env.DATA_DIR = root

let study: typeof import('../../src/server/study-store')
let fieldId = ''
let sectionId = ''
let noteId = ''
let questionId = ''

before(async () => {
  study = await import('../../src/server/study-store')
  const field = study.createStudyField('数学')
  const section = study.createStudySection(field.id, '基础')
  const note = study.createStudyNote(field.id, '函数入门', section.id)
  fieldId = field.id
  sectionId = section.id
  noteId = note.id
  questionId = 'question-one'
  study.saveStudyNote(note.id, note.updated_at, {
    blocks: [
      { id: 'long-markdown', type: 'markdown', content: `# 1.1 函数\n${'定义域和值域。'.repeat(2_000)}` },
      { id: questionId, type: 'question', question: '为什么函数的每个输入只能对应一个输出？', quote: '函数是一种对应关系。', replies: [] },
      { id: 'after-markdown', type: 'markdown', content: '## 1.2 映射\n这里继续学习映射。' },
    ],
  })
})

after(() => rmSync(root, { recursive: true, force: true }))

test('study notebook keeps fields, searchable notes and outlines', () => {
  const overview = study.listStudyOverview()
  assert.equal(overview.fields[0]?.id, fieldId)
  assert.equal(overview.sections[0]?.id, sectionId)
  assert.equal(overview.notes[0]?.section_id, sectionId)
  assert.equal(overview.notes[0]?.open_question_count, 1)
  assert.equal(study.searchStudy('定义域')[0]?.id, noteId)
  assert.deepEqual(study.studyNoteOutline(noteId).headings.map(item => item.title), ['1.1 函数', '1.2 映射'])
})

test('archiving a field or child page hides it without deleting its notes', () => {
  const field = study.createStudyField('编程')
  const section = study.createStudySection(field.id, 'Python')
  const note = study.createStudyNote(field.id, '语法', section.id)
  study.updateStudySection(section.id, { archived: true })
  assert.equal(study.listStudyOverview().notes.some(item => item.id === note.id), false)
  assert.equal(study.searchStudy('语法').some(item => item.id === note.id), false)
  assert.equal(study.getStudyNote(note.id).title, '语法')
  study.updateStudyField(field.id, { archived: true })
  assert.equal(study.listStudyOverview().fields.some(item => item.id === field.id), false)
})

test('long blocks are paged below the tool context budget', () => {
  const first = study.readStudyBlocks(noteId, 0, 8)
  assert.equal(first.next_start, 0)
  assert.equal(first.next_offset! > 0, true)
  assert.equal(JSON.stringify(first).length < 8_500, true)
  const second = study.readStudyBlocks(noteId, first.next_start, 8, first.next_offset)
  assert.equal((second.blocks[0] as any).content_offset, first.next_offset)
  assert.equal(JSON.stringify(second).length < 8_500, true)

  const context = study.readStudyQuestionContext(noteId, questionId)
  assert.equal(context.question.id, questionId)
  assert.equal(JSON.stringify(context).length < 12_000, true)
})

test('Star answers are idempotent and survive a later user note save', () => {
  const first = study.answerStudyQuestion(noteId, questionId, '因为函数要求单值对应。', 'answer-operation-1')
  const retried = study.answerStudyQuestion(noteId, questionId, '重试不应重复。', 'answer-operation-1')
  assert.equal(retried.id, first.id)

  const latest = study.getStudyNote(noteId)
  const clientBlocks = latest.blocks.map(block => block.type === 'question' ? { ...block, replies: [] } : block)
  const saved = study.saveStudyNote(noteId, latest.updated_at, { blocks: clientBlocks })
  const question = saved.blocks.find(block => block.type === 'question' && block.id === questionId)
  assert.equal(question?.type === 'question' ? question.replies.length : 0, 1)
  assert.equal(question?.type === 'question' ? question.replies[0]?.content : '', '因为函数要求单值对应。')
})

test('a user follow-up stays in the original question thread and reopens it', () => {
  const reply = study.addStudyQuestionReply(noteId, questionId, '那为什么不能对应两个输出？')
  const latest = study.getStudyNote(noteId)
  const question = latest.blocks.find(block => block.id === questionId)
  assert.equal(reply.author, 'fire')
  assert.equal(question?.type === 'question' ? question.status : '', 'open')
  assert.equal(question?.type === 'question' ? question.replies.at(-1)?.content : '', '那为什么不能对应两个输出？')
})

test('comments, assets and learning activity stay bounded', () => {
  const first = study.addStudyComment(noteId, '这里的例子很清楚。', { actor: 'star', operation_key: 'comment-operation-1' })
  const retried = study.addStudyComment(noteId, '不会重复。', { actor: 'star', operation_key: 'comment-operation-1' })
  assert.equal(retried.id, first.id)

  const asset = study.writeStudyAsset('image', 'data:image/png;base64,aGVsbG8=', '示意图')
  assert.equal(study.getStudyAsset(asset.id).bytes.toString(), 'hello')
  assert.match(study.studyLearningContext(), /小火近期学习/)
  assert.equal(study.studyLearningContext().length <= 800, true)
})
