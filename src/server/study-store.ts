import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { addMadridDays, formatMadrid, madridIsoWeekday, parseMadridDateTime } from '@/lib/madrid-time'
import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile, writeJsonFile } from './data/json-file'
import { assertIdentifier, resolveDataPath } from './data/safe-path'

export type StudyActor = 'fire' | 'star'
export type StudyQuestionStatus = 'open' | 'answered' | 'resolved'
export type StudyBlock = StudyMarkdownBlock | StudyQuestionBlock | StudyAssetBlock

export interface StudyField { id: string; name: string; archived: boolean; created_at: string; updated_at: string }
export interface StudyReply { id: string; author: StudyActor; content: string; operation_key?: string; created_at: string }
export interface StudyMarkdownBlock { id: string; type: 'markdown'; content: string }
export interface StudyQuestionBlock {
  id: string; type: 'question'; question: string; quote?: string; status: StudyQuestionStatus
  replies: StudyReply[]; created_at: string; updated_at: string
}
export interface StudyAssetBlock { id: string; type: 'image' | 'ink'; asset_id: string; caption: string }
export interface StudyComment {
  id: string; author: StudyActor; content: string; block_id?: string; quote?: string; operation_key?: string; created_at: string
}
export interface StudyNote {
  id: string; field_id: string; title: string; tags: string[]; pinned: boolean; archived: boolean
  blocks: StudyBlock[]; comments: StudyComment[]; created_at: string; updated_at: string
}
export interface StudyAsset {
  id: string; kind: 'image' | 'ink'; mime: 'image/jpeg' | 'image/png' | 'image/webp'; caption: string; strokes?: unknown[]; created_at: string
}
interface StudyIndex { fields: StudyField[] }
interface StudyActivity {
  id: string; at: string; last_at: string; kind: 'create' | 'edit' | 'question' | 'answer' | 'image' | 'ink'
  field_id: string; field_name: string; note_id: string; note_title: string; section?: string
}

const ROOT = resolveDataPath(getDataDir(), 'study')
const INDEX_FILE = resolveDataPath(ROOT, 'index.json')
const NOTES_DIR = resolveDataPath(ROOT, 'notes')
const ASSETS_DIR = resolveDataPath(ROOT, 'assets')
const ACTIVITY_DIR = resolveDataPath(ROOT, 'activity')
const ID = /^[A-Za-z0-9_-]{1,128}$/
const emptyIndex = (): StudyIndex => ({ fields: [] })
const indexOptions = {
  fallback: emptyIndex, fallbackOnInvalid: true,
  validate: (value: unknown) => !!value && typeof value === 'object' && Array.isArray((value as StudyIndex).fields),
}
const now = () => new Date().toISOString()
const text = (value: unknown, max: number) => String(value || '').trim().slice(0, max)
const actor = (value: unknown): StudyActor => value === 'star' ? 'star' : 'fire'
const safeId = (value: unknown, label = 'study id') => assertIdentifier(String(value || ''), ID, label)
const noteFile = (id: unknown) => resolveDataPath(NOTES_DIR, `${safeId(id, 'study note id')}.json`)
const assetMetaFile = (id: unknown) => resolveDataPath(ASSETS_DIR, `${safeId(id, 'study asset id')}.json`)
const activityFile = (day: string) => resolveDataPath(ACTIVITY_DIR, `${day}.json`)

function validNote(value: unknown): value is StudyNote {
  const note = value as Partial<StudyNote> | null
  return !!note && typeof note === 'object' && typeof note.id === 'string' && typeof note.field_id === 'string'
    && typeof note.title === 'string' && Array.isArray(note.tags) && Array.isArray(note.blocks) && Array.isArray(note.comments)
}
function validAsset(value: unknown): value is StudyAsset {
  const asset = value as Partial<StudyAsset> | null
  return !!asset && typeof asset === 'object' && typeof asset.id === 'string'
    && ['image', 'ink'].includes(String(asset.kind)) && ['image/jpeg', 'image/png', 'image/webp'].includes(String(asset.mime))
}
function validActivity(value: unknown): value is StudyActivity[] {
  return Array.isArray(value) && value.every(item => !!item && typeof item === 'object' && typeof item.id === 'string' && typeof item.at === 'string')
}
function readIndex(): StudyIndex { return readJsonFile(INDEX_FILE, indexOptions) }
function readAllNotes(): StudyNote[] {
  if (!fs.existsSync(NOTES_DIR)) return []
  return fs.readdirSync(NOTES_DIR).filter(file => file.endsWith('.json')).flatMap(file => {
    try { return [readJsonFile<StudyNote>(resolveDataPath(NOTES_DIR, file), { validate: validNote })] } catch { return [] }
  })
}
export function getStudyNote(id: unknown): StudyNote { return readJsonFile(noteFile(id), { validate: validNote }) }

function normalizeTags(value: unknown): string[] {
  return Array.isArray(value) ? Array.from(new Set(value.map(item => text(item, 40)).filter(Boolean))).slice(0, 20) : []
}
function normalizeBlock(value: any, previous?: StudyQuestionBlock): StudyBlock {
  const id = ID.test(String(value?.id || '')) ? String(value.id) : randomUUID()
  if (value?.type === 'question') {
    const at = previous?.created_at || now()
    return {
      id, type: 'question', question: text(value.question, 5_000) || previous?.question || '未命名问题',
      ...(text(value.quote, 2_000) ? { quote: text(value.quote, 2_000) } : previous?.quote ? { quote: previous.quote } : {}),
      status: previous?.status || 'open', replies: previous?.replies || [], created_at: at, updated_at: previous?.updated_at || at,
    }
  }
  if (value?.type === 'image' || value?.type === 'ink') return { id, type: value.type, asset_id: safeId(value.asset_id, 'study asset id'), caption: text(value.caption, 500) }
  return { id, type: 'markdown', content: String(value?.content || '').slice(0, 50_000) }
}
function normalizeBlocks(value: unknown, previous: StudyBlock[] = []): StudyBlock[] {
  if (!Array.isArray(value)) throw new Error('笔记内容无效')
  if (value.length > 500) throw new Error('一篇笔记最多 500 个内容块')
  const priorQuestions = new Map(previous.filter((item): item is StudyQuestionBlock => item.type === 'question').map(item => [item.id, item]))
  const blocks = value.map(item => normalizeBlock(item, priorQuestions.get(String(item?.id || ''))))
  if (new Set(blocks.map(item => item.id)).size !== blocks.length) throw new Error('笔记内容块 id 重复')
  if (blocks.reduce((sum, item) => sum + (item.type === 'markdown' ? item.content.length : item.type === 'question' ? item.question.length : item.caption.length), 0) > 500_000) throw new Error('一篇笔记最多 50 万字')
  return blocks.length ? blocks : [{ id: randomUUID(), type: 'markdown', content: '' }]
}

function studyDay(value: Date | number | string = new Date()): string {
  const formatted = formatMadrid(value, false)
  const day = formatted.slice(0, 10).replaceAll('/', '-')
  return Number(formatted.slice(11, 13)) < 5 ? addMadridDays(day, -1) : day
}
function fieldName(fieldId: string): string { return readIndex().fields.find(field => field.id === fieldId)?.name || '未分区' }
function sectionBefore(blocks: StudyBlock[], index: number): string | undefined {
  for (let i = index; i >= 0; i--) {
    const block = blocks[i]
    if (block?.type !== 'markdown') continue
    const heading = Array.from(block.content.matchAll(/^#{1,6}\s+(.+)$/gm)).at(-1)?.[1]?.trim()
    if (heading) return heading.slice(0, 160)
  }
}
function recordActivity(note: StudyNote, kind: StudyActivity['kind'], section?: string, at = new Date()): void {
  const day = studyDay(at)
  const timestamp = at.toISOString()
  updateJsonFile<StudyActivity[]>(activityFile(day), { fallback: () => [], fallbackOnInvalid: true, validate: validActivity }, entries => {
    const recent = [...entries].reverse().find(item => item.note_id === note.id && item.kind === kind && item.section === section)
    if (recent && at.getTime() - Date.parse(recent.last_at) <= 30 * 60_000) {
      recent.last_at = timestamp; recent.note_title = note.title; recent.field_name = fieldName(note.field_id); return entries
    }
    entries.push({ id: randomUUID(), at: timestamp, last_at: timestamp, kind, field_id: note.field_id, field_name: fieldName(note.field_id), note_id: note.id, note_title: note.title, ...(section ? { section } : {}) })
    return entries.slice(-300)
  })
}

export function listStudyOverview(includeArchived = false) {
  const fields = readIndex().fields.filter(field => includeArchived || !field.archived)
  const allowed = new Set(fields.map(field => field.id))
  const notes = readAllNotes().filter(note => allowed.has(note.field_id) && (includeArchived || !note.archived))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updated_at.localeCompare(a.updated_at))
  const summaries = notes.map(note => ({
    id: note.id, field_id: note.field_id, title: note.title, tags: note.tags, pinned: note.pinned, archived: note.archived, updated_at: note.updated_at,
    question_count: note.blocks.filter(block => block.type === 'question').length,
    open_question_count: note.blocks.filter(block => block.type === 'question' && block.status !== 'resolved').length,
  }))
  return { fields, notes: summaries, recent: summaries.slice(0, 6) }
}
export function createStudyField(nameValue: unknown): StudyField {
  const name = text(nameValue, 80)
  if (!name) throw new Error('分区名称不能为空')
  const at = now()
  const field: StudyField = { id: randomUUID(), name, archived: false, created_at: at, updated_at: at }
  updateJsonFile(INDEX_FILE, indexOptions, data => { data.fields.push(field); return data })
  return field
}
export function updateStudyField(idValue: unknown, patch: Record<string, unknown>): StudyField {
  const id = safeId(idValue, 'study field id')
  let saved!: StudyField
  updateJsonFile(INDEX_FILE, indexOptions, data => {
    const field = data.fields.find(item => item.id === id)
    if (!field) throw new Error('学习分区不存在')
    if (patch.name !== undefined) field.name = text(patch.name, 80) || field.name
    if (patch.archived !== undefined) field.archived = patch.archived === true
    field.updated_at = now(); saved = field; return data
  })
  return saved
}
export function createStudyNote(fieldIdValue: unknown, titleValue: unknown): StudyNote {
  const fieldId = safeId(fieldIdValue, 'study field id')
  const field = readIndex().fields.find(item => item.id === fieldId && !item.archived)
  if (!field) throw new Error('学习分区不存在')
  const at = now()
  const note: StudyNote = { id: randomUUID(), field_id: fieldId, title: text(titleValue, 180) || '未命名笔记', tags: [], pinned: false, archived: false, blocks: [{ id: randomUUID(), type: 'markdown', content: '' }], comments: [], created_at: at, updated_at: at }
  writeJsonFile(noteFile(note.id), note); recordActivity(note, 'create'); return note
}
export function saveStudyNote(idValue: unknown, expectedUpdatedAt: unknown, patch: Record<string, unknown>): StudyNote {
  const file = noteFile(idValue)
  let saved!: StudyNote
  const changed: Array<{ kind: StudyActivity['kind']; section?: string }> = []
  updateJsonFile<StudyNote>(file, { validate: validNote }, note => {
    if (typeof expectedUpdatedAt === 'string' && expectedUpdatedAt && note.updated_at !== expectedUpdatedAt) throw new Error('笔记已在别处更新，请重新打开后继续编辑')
    const previous = note.blocks
    if (patch.title !== undefined) note.title = text(patch.title, 180) || note.title
    if (patch.tags !== undefined) note.tags = normalizeTags(patch.tags)
    if (patch.pinned !== undefined) note.pinned = patch.pinned === true
    if (patch.archived !== undefined) note.archived = patch.archived === true
    if (patch.blocks !== undefined) {
      const next = normalizeBlocks(patch.blocks, previous)
      const oldById = new Map(previous.map(item => [item.id, item]))
      next.forEach((block, index) => {
        const old = oldById.get(block.id), section = sectionBefore(next, index)
        if (!old && block.type === 'question') changed.push({ kind: 'question', section })
        else if (!old && block.type === 'image') changed.push({ kind: 'image', section })
        else if (!old && block.type === 'ink') changed.push({ kind: 'ink', section })
        else if (block.type === 'markdown' && (!old || old.type !== 'markdown' || old.content !== block.content)) changed.push({ kind: 'edit', section })
      })
      note.blocks = next
    }
    note.updated_at = now(); saved = note; return note
  })
  const unique = new Map(changed.map(item => [`${item.kind}:${item.section || ''}`, item]))
  for (const item of Array.from(unique.values()).slice(0, 6)) recordActivity(saved, item.kind, item.section)
  return saved
}
export function setStudyQuestionStatus(noteId: unknown, questionIdValue: unknown, statusValue: unknown): StudyNote {
  const questionId = safeId(questionIdValue, 'study question id')
  const status: StudyQuestionStatus = statusValue === 'resolved' ? 'resolved' : statusValue === 'open' ? 'open' : 'answered'
  let saved!: StudyNote
  updateJsonFile<StudyNote>(noteFile(noteId), { validate: validNote }, note => {
    const question = note.blocks.find((block): block is StudyQuestionBlock => block.type === 'question' && block.id === questionId)
    if (!question) throw new Error('学习问题不存在')
    question.status = status; question.updated_at = now(); note.updated_at = question.updated_at; saved = note; return note
  })
  return saved
}
export function answerStudyQuestion(noteId: unknown, questionIdValue: unknown, contentValue: unknown, operationKeyValue: unknown): StudyReply {
  const questionId = safeId(questionIdValue, 'study question id'), content = text(contentValue, 20_000), operationKey = text(operationKeyValue, 180)
  if (!content || !operationKey) throw new Error('回答内容和 operation_key 不能为空')
  let saved!: StudyReply, noteSnapshot!: StudyNote, section: string | undefined
  updateJsonFile<StudyNote>(noteFile(noteId), { validate: validNote }, note => {
    const index = note.blocks.findIndex(block => block.type === 'question' && block.id === questionId)
    const question = note.blocks[index] as StudyQuestionBlock | undefined
    if (!question || question.type !== 'question') throw new Error('学习问题不存在')
    const existing = question.replies.find(reply => reply.operation_key === operationKey)
    if (existing) { saved = existing; noteSnapshot = note; return undefined }
    saved = { id: randomUUID(), author: 'star', content, operation_key: operationKey, created_at: now() }
    question.replies.push(saved); question.status = 'answered'; question.updated_at = saved.created_at; note.updated_at = saved.created_at
    section = sectionBefore(note.blocks, index); noteSnapshot = note; return note
  })
  recordActivity(noteSnapshot, 'answer', section); return saved
}
export function addStudyQuestionReply(noteId: unknown, questionIdValue: unknown, contentValue: unknown): StudyReply {
  const questionId = safeId(questionIdValue, 'study question id'), content = text(contentValue, 20_000)
  if (!content) throw new Error('追问内容不能为空')
  let saved!: StudyReply, noteSnapshot!: StudyNote, section: string | undefined
  updateJsonFile<StudyNote>(noteFile(noteId), { validate: validNote }, note => {
    const index = note.blocks.findIndex(block => block.type === 'question' && block.id === questionId)
    const question = note.blocks[index] as StudyQuestionBlock | undefined
    if (!question || question.type !== 'question') throw new Error('学习问题不存在')
    saved = { id: randomUUID(), author: 'fire', content, created_at: now() }
    question.replies.push(saved); question.status = 'open'; question.updated_at = saved.created_at; note.updated_at = saved.created_at
    section = sectionBefore(note.blocks, index); noteSnapshot = note; return note
  })
  recordActivity(noteSnapshot, 'question', section); return saved
}
export function addStudyComment(noteId: unknown, contentValue: unknown, options: { actor?: unknown; block_id?: unknown; quote?: unknown; operation_key?: unknown } = {}): StudyComment {
  const content = text(contentValue, 10_000), operationKey = text(options.operation_key, 180)
  if (!content) throw new Error('评论不能为空')
  let saved!: StudyComment
  updateJsonFile<StudyNote>(noteFile(noteId), { validate: validNote }, note => {
    const existing = operationKey ? note.comments.find(comment => comment.operation_key === operationKey) : undefined
    if (existing) { saved = existing; return undefined }
    const blockId = options.block_id ? safeId(options.block_id, 'study block id') : undefined
    if (blockId && !note.blocks.some(block => block.id === blockId)) throw new Error('评论位置不存在')
    saved = { id: randomUUID(), author: actor(options.actor), content, ...(blockId ? { block_id: blockId } : {}), ...(text(options.quote, 2_000) ? { quote: text(options.quote, 2_000) } : {}), ...(operationKey ? { operation_key: operationKey } : {}), created_at: now() }
    note.comments.push(saved); note.updated_at = saved.created_at; return note
  })
  return saved
}
export function listStudyQuestions(statusValue?: unknown) {
  const status = ['open', 'answered', 'resolved'].includes(String(statusValue)) ? String(statusValue) : ''
  const fields = new Map(readIndex().fields.map(field => [field.id, field.name]))
  return readAllNotes().flatMap(note => note.blocks.flatMap((block, index) => block.type === 'question' && (!status || block.status === status) ? [{ note_id: note.id, note_title: note.title, field_id: note.field_id, field_name: fields.get(note.field_id) || '未分区', section: sectionBefore(note.blocks, index), question: block }] : [])).sort((a, b) => b.question.updated_at.localeCompare(a.question.updated_at))
}
function searchable(note: StudyNote): string {
  return [note.title, ...note.tags, ...note.blocks.flatMap(block => block.type === 'markdown' ? [block.content] : block.type === 'question' ? [block.question, block.quote || '', ...block.replies.map(reply => reply.content)] : [block.caption]), ...note.comments.map(comment => `${comment.content} ${comment.quote || ''}`)].join('\n')
}
export function searchStudy(queryValue: unknown, limitValue: unknown = 20) {
  const query = text(queryValue, 200).toLocaleLowerCase()
  if (!query) return []
  const limit = Math.max(1, Math.min(30, Number(limitValue) || 20)), fields = new Map(readIndex().fields.map(field => [field.id, field.name]))
  return readAllNotes().filter(note => !note.archived).flatMap(note => {
    const haystack = searchable(note), index = haystack.toLocaleLowerCase().indexOf(query)
    return index < 0 ? [] : [{ id: note.id, field_id: note.field_id, field_name: fields.get(note.field_id), title: note.title, tags: note.tags, updated_at: note.updated_at, excerpt: haystack.slice(Math.max(0, index - 90), index + query.length + 150) }]
  }).sort((a, b) => Number(b.title.toLocaleLowerCase().includes(query)) - Number(a.title.toLocaleLowerCase().includes(query)) || b.updated_at.localeCompare(a.updated_at)).slice(0, limit)
}
export function studyNoteOutline(noteId: unknown) {
  const note = getStudyNote(noteId)
  const headings = note.blocks.flatMap((block, blockIndex) => block.type === 'markdown' ? Array.from(block.content.matchAll(/^(#{1,6})\s+(.+)$/gm)).map(match => ({ block_id: block.id, block_index: blockIndex, level: match[1].length, title: match[2].trim().slice(0, 180) })) : [])
  return { note: { id: note.id, field_id: note.field_id, title: note.title, tags: note.tags, updated_at: note.updated_at }, headings, counts: { blocks: note.blocks.length, markdown: note.blocks.filter(block => block.type === 'markdown').length, images: note.blocks.filter(block => block.type === 'image' || block.type === 'ink').length, questions: note.blocks.filter(block => block.type === 'question').length } }
}
function toolQuestion(block: StudyQuestionBlock) {
  return {
    ...block,
    question: block.question.slice(0, 3_000),
    ...(block.quote ? { quote: block.quote.slice(0, 800) } : {}),
    replies: block.replies.slice(-3).map(reply => ({ ...reply, content: reply.content.slice(0, 1_200) })),
  }
}
function toolBlock(block: StudyBlock, markdownLimit = 6_000) {
  if (block.type === 'markdown') return { id: block.id, type: block.type, content: block.content.slice(0, markdownLimit), truncated: block.content.length > markdownLimit }
  if (block.type === 'question') return toolQuestion(block)
  return { ...block, image_note: '图片默认不加载画面；需要细看时用 mode=view_asset 与 asset_id。' }
}
export function readStudyBlocks(noteId: unknown, startValue: unknown = 0, limitValue: unknown = 8, offsetValue: unknown = 0) {
  const note = getStudyNote(noteId), start = Math.max(0, Number(startValue) || 0), limit = Math.max(1, Math.min(12, Number(limitValue) || 8))
  let offset = Math.max(0, Number(offsetValue) || 0)
  const picked: Array<Record<string, unknown>> = []
  let chars = 0, index = start
  while (index < note.blocks.length && picked.length < limit && chars < 8_000) {
    const source = note.blocks[index]
    const take = Math.max(500, 7_500 - chars)
    const content = source.type === 'markdown' ? source.content.slice(offset, offset + take) : ''
    const contentComplete = source.type !== 'markdown' || offset + take >= source.content.length
    const block: Record<string, unknown> = source.type === 'markdown'
      ? { id: source.id, type: source.type, content, content_offset: offset, content_complete: contentComplete }
      : toolBlock(source)
    const size = JSON.stringify(block).length
    if (picked.length && chars + size > 8_000) break
    picked.push(block); chars += size
    if (source.type === 'markdown' && !contentComplete) {
      offset += content.length
      break
    }
    index++; offset = 0
  }
  return { note: { id: note.id, title: note.title }, start, offset: Math.max(0, Number(offsetValue) || 0), blocks: picked, next_start: index < note.blocks.length ? index : null, next_offset: index < note.blocks.length ? offset : null }
}
export function readStudyQuestionContext(noteId: unknown, questionIdValue: unknown) {
  const questionId = safeId(questionIdValue, 'study question id'), note = getStudyNote(noteId)
  const index = note.blocks.findIndex(block => block.type === 'question' && block.id === questionId)
  if (index < 0) throw new Error('学习问题不存在')
  return { note: { id: note.id, field_id: note.field_id, title: note.title, tags: note.tags }, section: sectionBefore(note.blocks, index), before: note.blocks.slice(Math.max(0, index - 2), index).map(block => toolBlock(block, 1_200)), question: toolQuestion(note.blocks[index] as StudyQuestionBlock), after: note.blocks.slice(index + 1, index + 3).map(block => toolBlock(block, 1_200)) }
}
export function writeStudyAsset(kindValue: unknown, dataUrlValue: unknown, captionValue: unknown, strokesValue?: unknown): StudyAsset {
  const kind: StudyAsset['kind'] = kindValue === 'ink' ? 'ink' : 'image'
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([a-z0-9+/=\r\n]+)$/i.exec(String(dataUrlValue || ''))
  if (!match) throw new Error('只支持 JPEG、PNG 或 WebP 图片')
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('图片必须小于 8MB')
  const strokes = Array.isArray(strokesValue) ? strokesValue : undefined
  if (strokes && JSON.stringify(strokes).length > 1_000_000) throw new Error('手写笔画数据过大')
  const id = `asset-${randomUUID()}`, mime = match[1].toLowerCase() as StudyAsset['mime']
  const asset: StudyAsset = { id, kind, mime, caption: text(captionValue, 500), ...(strokes ? { strokes } : {}), created_at: now() }
  fs.mkdirSync(ASSETS_DIR, { recursive: true })
  const image = resolveDataPath(ASSETS_DIR, `${id}.${mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1]}`), temporary = `${image}.${process.pid}.${Date.now()}.tmp`
  try { fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, image); writeJsonFile(assetMetaFile(id), asset) }
  catch (error) { try { fs.unlinkSync(temporary) } catch {}; try { fs.unlinkSync(image) } catch {}; throw error }
  return asset
}
export function getStudyAsset(idValue: unknown): { asset: StudyAsset; bytes: Buffer } {
  const id = safeId(idValue, 'study asset id'), asset = readJsonFile<StudyAsset>(assetMetaFile(id), { validate: validAsset })
  const extension = asset.mime === 'image/jpeg' ? 'jpg' : asset.mime.split('/')[1]
  return { asset, bytes: fs.readFileSync(resolveDataPath(ASSETS_DIR, `${id}.${extension}`)) }
}
export function studyAssetForTool(idValue: unknown) {
  const { asset, bytes } = getStudyAsset(idValue)
  return { id: asset.id, kind: asset.kind, caption: asset.caption, url: `data:${asset.mime};base64,${bytes.toString('base64')}` }
}
function readActivities(day: string): StudyActivity[] { return readJsonFile(activityFile(day), { fallback: () => [] as StudyActivity[], fallbackOnInvalid: true, validate: validActivity }) }
function actionText(entry: StudyActivity, includeTime: boolean) {
  const verb = entry.kind === 'create' ? '新建了' : entry.kind === 'question' ? '在笔记中提出了问题' : entry.kind === 'answer' ? '收到了一个问题回答' : entry.kind === 'image' ? '插入了图片' : entry.kind === 'ink' ? '添加了手写' : '编辑了'
  return `${includeTime ? `${formatMadrid(entry.at, false).slice(-5)} ` : ''}小火${verb}《${entry.note_title}》${entry.section ? `的「${entry.section}」` : ''}。`
}
function weekStart(day: string): string {
  const noon = parseMadridDateTime(`${day}T12:00:00`) || new Date()
  return addMadridDays(day, 1 - madridIsoWeekday(noon))
}
export function studyLearningContext(value: Date | number | string = new Date()): string {
  const today = studyDay(value), yesterday = addMadridDays(today, -1), start = weekStart(today), todayItems = readActivities(today), yesterdayItems = readActivities(yesterday), older: StudyActivity[] = []
  for (let day = start; day < yesterday; day = addMadridDays(day, 1)) older.push(...readActivities(day))
  if (!todayItems.length && !yesterdayItems.length && !older.length) return ''
  const parts = ['[小火近期学习]']
  if (todayItems.length) {
    const lines = todayItems.slice(-6).map(item => actionText(item, true))
    if (todayItems.length > 6) lines.push(`今天还有 ${todayItems.length - 6} 项学习变化已合并。`)
    parts.push(`今天（05:00起）：\n${lines.join('\n')}`)
  }
  if (yesterdayItems.length) {
    const unique = Array.from(new Map(yesterdayItems.map(item => [`${item.note_id}:${item.section || ''}:${item.kind}`, item])).values()).slice(0, 6)
    parts.push(`昨天：\n${unique.map(item => actionText(item, false)).join('\n')}`)
  }
  if (older.length) {
    const grouped = new Map<string, Set<string>>()
    for (const item of older) grouped.set(item.field_name, (grouped.get(item.field_name) || new Set()).add(item.note_title))
    parts.push(`本周较早：\n${Array.from(grouped).slice(0, 4).map(([field, notes]) => `${field}：${Array.from(notes).slice(0, 4).join('、')}`).join('；')}。`)
  }
  return parts.join('\n\n').slice(0, 800)
}
export function listStudyActivity() {
  const today = studyDay(), yesterday = addMadridDays(today, -1), start = weekStart(today), older: StudyActivity[] = []
  for (let day = start; day < yesterday; day = addMadridDays(day, 1)) older.push(...readActivities(day))
  return { today: readActivities(today), yesterday: readActivities(yesterday), older, week_start: start, day_start_hour: 5 }
}
