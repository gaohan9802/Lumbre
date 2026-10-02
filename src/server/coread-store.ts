import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { PDFParse } from 'pdf-parse'
import type { CoreadAnnotation, CoreadBook, CoreadChapter, CoreadParagraph, CoreadState } from '@/lib/coread'
import type { CoreadFormat, MediaActor } from '@/lib/media-library'
import { addCoreadEvent, getMediaWork, removeCoreadEvent, setCoreadReady } from './media-library-store'
import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile, writeJsonFile } from './data/json-file'
import { assertIdentifier, resolveDataPath } from './data/safe-path'

const MAX_FILE_BYTES = 30 * 1024 * 1024
const MAX_TEXT_CHARS = 8_000_000
const MAX_ZIP_ENTRIES = 5000
const MAX_ZIP_BYTES = 100 * 1024 * 1024
const ROOT = resolveDataPath(getDataDir(), 'media-library', 'readers')
const emptyState = (): CoreadState => ({ version: 1, progress: {}, annotations: [] })
const cleanText = (value: unknown, max: number) => typeof value === 'string' ? value.trim().slice(0, max) : ''

function readerDir(workId: string): string {
  return resolveDataPath(ROOT, assertIdentifier(workId, /^[a-f0-9-]{8,80}$/i, 'work id'))
}
function bookFile(workId: string): string { return resolveDataPath(readerDir(workId), 'book.json') }
function stateFile(workId: string): string { return resolveDataPath(readerDir(workId), 'state.json') }

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, key: string) => {
    if (key[0] === '#') {
      const hex = key[1]?.toLowerCase() === 'x'
      const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
    }
    return named[key.toLowerCase()] ?? ''
  })
}

function htmlToText(html: string): { title?: string; text: string } {
  const titleMatch = /<(?:h1|h2|title)\b[^>]*>([\s\S]*?)<\/(?:h1|h2|title)>/i.exec(html)
  const strip = (value: string) => decodeEntities(value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
  const text = decodeEntities(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|blockquote|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, ''))
  return { title: titleMatch ? strip(titleMatch[1]) : undefined, text }
}

function splitParagraphs(value: string): string[] {
  const normalized = value.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  if (!normalized) return []
  const blocks = normalized.split(/\n\s*\n/).flatMap(block => block.length > 2400
    ? block.split(/(?<=[。！？.!?])\s+/).reduce<string[]>((parts, sentence) => {
        if (!sentence.trim()) return parts
        if (!parts.length || parts[parts.length - 1].length + sentence.length > 2200) parts.push(sentence.trim())
        else parts[parts.length - 1] += ` ${sentence.trim()}`
        return parts
      }, [])
    : [block])
  return blocks.map(block => block.replace(/\s*\n\s*/g, '\n').trim()).filter(Boolean)
}

function buildBook(workId: string, fileName: string, format: CoreadFormat, sections: { title: string; text: string }[], checksum: string): CoreadBook {
  const paragraphs: CoreadParagraph[] = []
  const chapters: CoreadChapter[] = []
  sections.forEach((section, sectionIndex) => {
    const chapterParagraphs = splitParagraphs(section.text)
    if (!chapterParagraphs.length) return
    const id = `chapter-${sectionIndex + 1}`
    const start = paragraphs.length
    chapterParagraphs.forEach(text => paragraphs.push({ idx: paragraphs.length, chapter_id: id, text }))
    chapters.push({ id, title: cleanText(section.title, 200) || `第 ${chapters.length + 1} 章`, start_idx: start, end_idx: paragraphs.length - 1 })
  })
  if (!paragraphs.length) throw new Error('没有从文件中读到正文')
  if (paragraphs.reduce((sum, item) => sum + item.text.length, 0) > MAX_TEXT_CHARS) throw new Error('提取出的正文过大')
  return { version: 1, work_id: workId, file_name: fileName, format, checksum, chapters, paragraphs, created_at: new Date().toISOString() }
}

function attribute(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)
  return decodeEntities(match?.[1] || '')
}

export function parseEpubSections(bytes: Buffer): { title: string; text: string }[] {
  const zip = new AdmZip(bytes)
  const entries = zip.getEntries()
  if (!entries.length || entries.length > MAX_ZIP_ENTRIES) throw new Error('EPUB 文件结构异常')
  let total = 0
  const byName = new Map<string, AdmZip.IZipEntry>()
  for (const entry of entries) {
    if (entry.entryName.startsWith('/') || entry.entryName.includes('\\') || entry.entryName.split('/').includes('..')) throw new Error('EPUB 包含不安全路径')
    total += entry.header.size
    if (total > MAX_ZIP_BYTES || (entry.header.compressedSize > 0 && entry.header.size / entry.header.compressedSize > 250)) throw new Error('EPUB 解压后过大')
    byName.set(entry.entryName, entry)
  }
  const mimetype = byName.get('mimetype')?.getData().toString('utf8').trim()
  if (mimetype !== 'application/epub+zip') throw new Error('不是有效的 EPUB 文件')
  const container = byName.get('META-INF/container.xml')?.getData().toString('utf8') || ''
  const opfName = attribute(container.match(/<rootfile\b[^>]*>/i)?.[0] || '', 'full-path')
  const opfEntry = byName.get(opfName)
  if (!opfName || !opfEntry) throw new Error('EPUB 缺少目录信息')
  const opf = opfEntry.getData().toString('utf8')
  const base = path.posix.dirname(opfName)
  const manifest = new Map<string, string>()
  for (const match of Array.from(opf.matchAll(/<item\b[^>]*>/gi))) {
    const id = attribute(match[0], 'id')
    const href = attribute(match[0], 'href')
    const mediaType = attribute(match[0], 'media-type')
    if (id && href && /xhtml|html/i.test(mediaType)) manifest.set(id, path.posix.normalize(path.posix.join(base, decodeURIComponent(href))))
  }
  const sections: { title: string; text: string }[] = []
  for (const match of Array.from(opf.matchAll(/<itemref\b[^>]*>/gi))) {
    const name = manifest.get(attribute(match[0], 'idref'))
    const entry = name ? byName.get(name) : undefined
    if (!entry) continue
    const parsed = htmlToText(entry.getData().toString('utf8'))
    if (parsed.text.trim()) sections.push({ title: parsed.title || `第 ${sections.length + 1} 章`, text: parsed.text })
  }
  if (!sections.length) throw new Error('EPUB 中没有可读取的正文')
  return sections
}

function parseTxt(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.alloc(bytes.length - 2)
    for (let i = 2; i + 1 < bytes.length; i += 2) { swapped[i - 2] = bytes[i + 1]; swapped[i - 1] = bytes[i] }
    return new TextDecoder('utf-16le').decode(swapped)
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

async function parseSections(format: CoreadFormat, bytes: Buffer): Promise<{ title: string; text: string }[]> {
  if (format === 'txt') return [{ title: '正文', text: parseTxt(bytes) }]
  if (format === 'epub') return parseEpubSections(bytes)
  const parser = new PDFParse({ data: new Uint8Array(bytes) })
  try {
    const result = await parser.getText()
    if (result.total > 3000) throw new Error('PDF 页数过多')
    return result.pages.map(page => ({ title: `第 ${page.num} 页`, text: page.text }))
  } finally {
    await parser.destroy()
  }
}

function formatOf(fileName: string): CoreadFormat {
  const extension = path.extname(fileName).toLowerCase().slice(1)
  if (extension === 'epub' || extension === 'pdf' || extension === 'txt') return extension
  throw new Error('只支持 EPUB、PDF 或 TXT 文件')
}

function writeSource(workId: string, format: CoreadFormat, bytes: Buffer): void {
  const directory = readerDir(workId)
  fs.mkdirSync(directory, { recursive: true })
  const target = resolveDataPath(directory, `source.${format}`)
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
  try { fs.writeFileSync(temporary, bytes, { flag: 'wx' }); fs.renameSync(temporary, target) }
  finally { try { fs.unlinkSync(temporary) } catch {} }
}

export async function importCoreadDocument(actor: MediaActor, workId: string, file: { name: string; bytes: Buffer }): Promise<CoreadBook> {
  const work = getMediaWork(workId)
  if (!work || work.kind !== 'book') throw new Error('book not found')
  if (file.bytes.length < 1 || file.bytes.length > MAX_FILE_BYTES) throw new Error('文件必须小于 30MB')
  if (fs.existsSync(bookFile(workId))) throw new Error('这本书已经有共读文件')
  const format = formatOf(file.name)
  if (format === 'pdf' && file.bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('不是有效的 PDF 文件')
  const checksum = createHash('sha256').update(file.bytes).digest('hex')
  const book = buildBook(workId, path.basename(file.name).slice(0, 240), format, await parseSections(format, file.bytes), checksum)
  writeSource(workId, format, file.bytes)
  writeJsonFile(bookFile(workId), book)
  writeJsonFile(stateFile(workId), emptyState())
  setCoreadReady(actor, workId, { file_name: book.file_name, format, paragraph_count: book.paragraphs.length, chapter_count: book.chapters.length })
  return book
}

function readBook(workId: string): CoreadBook {
  return readJsonFile(bookFile(workId), { validate: value => !!value && typeof value === 'object' && Array.isArray((value as CoreadBook).paragraphs) })
}
function readState(workId: string): CoreadState {
  return readJsonFile(stateFile(workId), { fallback: emptyState, fallbackOnInvalid: true, validate: value => !!value && typeof value === 'object' })
}

export function readCoreadProgress(workId: string): CoreadState['progress'] {
  return fs.existsSync(stateFile(workId)) ? readState(workId).progress : {}
}

export function readCoread(workId: string, options: { actor?: MediaActor; start?: number; chapter_id?: string; limit?: number } = {}) {
  const book = readBook(workId)
  const state = readState(workId)
  const chapter = options.chapter_id ? book.chapters.find(item => item.id === options.chapter_id) : undefined
  const fallback = options.actor ? state.progress[options.actor]?.paragraph_idx : undefined
  const start = Math.max(0, Math.min(book.paragraphs.length - 1, Number.isInteger(options.start) ? Number(options.start) : chapter?.start_idx ?? fallback ?? 0))
  const limit = Math.max(1, Math.min(40, Number(options.limit) || 20))
  const paragraphs = book.paragraphs.slice(start, start + limit)
  const end = paragraphs.at(-1)?.idx ?? start
  return {
    book: { work_id: book.work_id, file_name: book.file_name, format: book.format, chapters: book.chapters, paragraph_count: book.paragraphs.length },
    paragraphs,
    progress: state.progress,
    annotations: state.annotations.filter(item => item.paragraph_idx >= start && item.paragraph_idx <= end),
    next: end + 1 < book.paragraphs.length ? end + 1 : null,
    previous: start > 0 ? Math.max(0, start - limit) : null,
  }
}

export function updateCoreadProgress(actor: MediaActor, workId: string, paragraphValue: unknown, offsetValue: unknown = 0) {
  const book = readBook(workId)
  const paragraph = Number(paragraphValue)
  const offset = Number(offsetValue)
  const target = Number.isInteger(paragraph) ? book.paragraphs[paragraph] : undefined
  if (!target || !Number.isInteger(offset) || offset < 0 || offset > target.text.length) throw new Error('invalid reading position')
  const progress = { paragraph_idx: paragraph, offset, updated_at: new Date().toISOString() }
  updateJsonFile(stateFile(workId), { fallback: emptyState, fallbackOnInvalid: true }, state => {
    state.progress ||= {}
    state.progress[actor] = progress
    return state
  })
  return progress
}

export function writeCoreadAnnotation(actor: MediaActor, workId: string, input: { annotation_id?: string; paragraph_idx?: unknown; start_offset?: unknown; end_offset?: unknown; content?: unknown; reply_to?: string }) {
  const book = readBook(workId)
  const content = cleanText(input.content, 3000)
  let created = false
  let saved!: CoreadAnnotation
  updateJsonFile(stateFile(workId), { fallback: emptyState, fallbackOnInvalid: true }, state => {
    state.annotations ||= []
    const now = new Date().toISOString()
    if (input.annotation_id) {
      const existing = state.annotations.find(item => item.id === input.annotation_id && item.author === actor)
      if (!existing) throw new Error('annotation not found or not owned')
      if (!content) throw new Error('content required')
      existing.content = content
      existing.updated_at = now
      saved = existing
      return state
    }
    const parent = input.reply_to ? state.annotations.find(item => item.id === input.reply_to) : undefined
    if (input.reply_to && !parent) throw new Error('reply target not found')
    const paragraphIdx = parent?.paragraph_idx ?? Number(input.paragraph_idx)
    const paragraph = Number.isInteger(paragraphIdx) ? book.paragraphs[paragraphIdx] : undefined
    if (!paragraph) throw new Error('paragraph not found')
    const start = parent?.start_offset ?? Number(input.start_offset)
    const end = parent?.end_offset ?? Number(input.end_offset)
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > paragraph.text.length) throw new Error('invalid text selection')
    if (!content && parent) throw new Error('content required')
    saved = {
      id: randomUUID(), author: actor, paragraph_idx: paragraphIdx, start_offset: start, end_offset: end,
      selected_text: paragraph.text.slice(start, end).slice(0, 2000), content, reply_to: parent?.id,
      created_at: now, updated_at: now,
    }
    state.annotations.push(saved)
    created = true
    return state
  })
  if (created) addCoreadEvent(actor, workId, saved.content || saved.selected_text, saved.id)
  return saved
}

export function deleteCoreadAnnotation(actor: MediaActor, workId: string, annotationId: string): 'ok' | 'not_found' | 'has_replies' {
  let result: 'ok' | 'not_found' | 'has_replies' = 'not_found'
  updateJsonFile(stateFile(workId), { fallback: emptyState, fallbackOnInvalid: true }, state => {
    const index = state.annotations.findIndex(item => item.id === annotationId && item.author === actor)
    if (index < 0) return undefined
    if (state.annotations.some(item => item.reply_to === annotationId)) { result = 'has_replies'; return undefined }
    state.annotations.splice(index, 1)
    result = 'ok'
    return state
  })
  if ((result as string) === 'ok') removeCoreadEvent(workId, annotationId)
  return result
}
