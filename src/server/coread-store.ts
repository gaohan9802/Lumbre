/**
 * coread-store.ts — 共读系统存储层
 * 参考 Lumenocturne/coread 的架构，使用 JSON 文件存储
 * 数据存放于 /persistent/coread/
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const DATA_DIR = process.env.DATA_DIR || '/persistent'
const COREAD_DIR = path.join(DATA_DIR, 'coread')
const BOOKS_DIR = path.join(COREAD_DIR, 'books')
const CHATS_DIR = path.join(COREAD_DIR, 'chats')
const NOTES_FILE = path.join(COREAD_DIR, 'reading-notes.json')

function ensureDirs() {
  for (const dir of [COREAD_DIR, BOOKS_DIR, CHATS_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}
ensureDirs()

// ── Types ──

export interface Book {
  id: string
  title: string
  author: string
  cover?: string
  description?: string
  lastChapter: number
  lastReadAt: string
  progress: number
  totalChars: number
  createdAt: string
}

export type CoreadAuthor = 'star' | 'fire'
export type CoreadAnnotationKind = 'highlight' | 'comment' | 'bookmark'

export interface CoreadReadingNote {
  id: string
  bookId: string
  bookTitle: string
  author: CoreadAuthor
  date: string
  chapterNum: number
  progress: number
  content: string
  kind: 'note' | 'progress' | 'reflection'
  createdAt: string
  updatedAt: string
}

export interface Chapter {
  id: string
  bookId: string
  chapterNum: number
  title: string
  content: string
  digest: string  // ≤120字脉络摘要
}

export interface Annotation {
  id: string
  bookId: string
  chapterNum: number
  originalText: string
  annotation: string
  annotator: 'user' | 'ai'
  author?: CoreadAuthor
  kind?: CoreadAnnotationKind
  color?: string
  createdAt: string
}

export interface ChatMessage {
  id: number
  bookId: string
  cnum: number
  who: 'user' | 'ai'
  text: string
  createdAt: string
}

interface BookData {
  book: Book
  chapters: Chapter[]
  annotations: Annotation[]
}

// ── Helpers ──

function bookPath(bookId: string): string {
  return path.join(BOOKS_DIR, `${bookId}.json`)
}

function chatsPath(bookId: string): string {
  return path.join(CHATS_DIR, `${bookId}.json`)
}

function loadBookData(bookId: string): BookData | null {
  const fp = bookPath(bookId)
  if (!fs.existsSync(fp)) return null
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'))
  } catch { return null }
}

function saveBookData(data: BookData): void {
  ensureDirs()
  fs.writeFileSync(bookPath(data.book.id), JSON.stringify(data, null, 2))
}

function loadChats(bookId: string): ChatMessage[] {
  const fp = chatsPath(bookId)
  if (!fs.existsSync(fp)) return []
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8'))
  } catch { return [] }
}

function saveChats(bookId: string, chats: ChatMessage[]): void {
  ensureDirs()
  fs.writeFileSync(chatsPath(bookId), JSON.stringify(chats, null, 2))
}

function genId(): string {
  return crypto.randomUUID().slice(0, 8)
}

function nowStr(): string {
  return new Date().toISOString()
}

// ── EPUB Parsing (minimal, no external deps) ──

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|blockquote|h[1-6])>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── Public API ──

export function listBooks(): Book[] {
  ensureDirs()
  const files = fs.readdirSync(BOOKS_DIR).filter(f => f.endsWith('.json'))
  const books: Book[] = []
  for (const f of files) {
    try {
      const data: BookData = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, f), 'utf-8'))
      const totalChars = data.book.totalChars || (data.chapters || []).reduce((n: number, c: Chapter) => n + (c.content || '').length, 0)
      books.push({ ...data.book, totalChars, progress: data.book.progress || 0 })
    } catch { /* skip */ }
  }
  books.sort((a, b) => (b.lastReadAt || b.createdAt).localeCompare(a.lastReadAt || a.createdAt))
  return books
}

export function getBook(bookId: string): BookData | null {
  return loadBookData(bookId)
}

export function getChapter(bookId: string, chapterNum: number): Chapter | null {
  const data = loadBookData(bookId)
  if (!data) return null
  return data.chapters.find(c => c.chapterNum === chapterNum) || null
}

export function getChapterList(bookId: string): { chapterNum: number; title: string; hasDigest: boolean }[] {
  const data = loadBookData(bookId)
  if (!data) return []
  return data.chapters.map(c => ({
    chapterNum: c.chapterNum,
    title: c.title,
    hasDigest: !!c.digest
  }))
}

export function updateProgress(bookId: string, chapterNum: number, progress?: number): void {
  const data = loadBookData(bookId)
  if (!data) return
  data.book.lastChapter = chapterNum
  data.book.lastReadAt = nowStr()
  const chapterIndex = Math.max(0, data.chapters.findIndex(c => c.chapterNum === chapterNum))
  const chapterProgress = typeof progress === 'number' ? Math.max(0, Math.min(100, progress)) : 0
  data.book.progress = data.chapters.length
    ? Math.max(0, Math.min(100, ((chapterIndex + chapterProgress / 100) / data.chapters.length) * 100))
    : chapterProgress
  saveBookData(data)
}

export function updateAbsoluteProgress(bookId: string, chapterNum: number, progress: number): void {
  const data = loadBookData(bookId)
  if (!data) return
  data.book.lastChapter = Math.max(0, chapterNum || data.book.lastChapter || 0)
  data.book.lastReadAt = nowStr()
  data.book.progress = Math.max(0, Math.min(100, Number(progress) || 0))
  saveBookData(data)
}

// Import book from parsed chapters
export function importBook(title: string, author: string, chapters: { title: string; content: string }[], cover = '', description = ''): Book {
  const bookId = 'book_' + genId()
  const now = nowStr()
  const book: Book = {
    id: bookId,
    title,
    author,
    cover,
    description,
    lastChapter: 0,
    lastReadAt: '',
    progress: 0,
    totalChars: chapters.reduce((n, c) => n + (c.content || '').length, 0),
    createdAt: now,
  }
  const chapterObjs: Chapter[] = chapters.map((c, i) => ({
    id: `${bookId}_ch${i + 1}`,
    bookId,
    chapterNum: i + 1,
    title: c.title,
    content: c.content,
    digest: '',
  }))
  saveBookData({ book, chapters: chapterObjs, annotations: [] })
  return book
}

// Import plain text as a single-chapter book
export function importText(title: string, author: string, text: string): Book {
  return importBook(title, author, [{ title: title, content: text }])
}

// Import plain text with chapter splitting (split by headings or double newlines)
export function importTextWithSplit(title: string, author: string, text: string): Book {
  // Try splitting by common chapter patterns
  const chapterPattern = /^(?:第[一二三四五六七八九十百千\d]+[章节篇回]|Chapter\s+\d+|CHAPTER\s+\d+)/m
  const parts = text.split(chapterPattern)
  const headings = text.match(new RegExp(chapterPattern.source, 'gm')) || []
  
  if (parts.length > 2) {
    const chapters: { title: string; content: string }[] = []
    // First part before any chapter heading
    if (parts[0].trim().length > 50) {
      chapters.push({ title: '序', content: parts[0].trim() })
    }
    for (let i = 1; i < parts.length; i++) {
      const content = parts[i].trim()
      if (content.length < 20) continue
      chapters.push({
        title: headings[i - 1] || `第${chapters.length + 1}章`,
        content
      })
    }
    if (chapters.length > 0) {
      return importBook(title, author, chapters)
    }
  }
  
  // Fallback: split by large gaps or treat as single chapter
  return importBook(title, author, [{ title, content: text }])
}

// Delete a book
export function deleteBook(bookId: string): boolean {
  const fp = bookPath(bookId)
  const cp = chatsPath(bookId)
  let deleted = false
  if (fs.existsSync(fp)) { fs.unlinkSync(fp); deleted = true }
  if (fs.existsSync(cp)) { fs.unlinkSync(cp) }
  return deleted
}

// ── Annotations ──

export function getAnnotations(bookId: string, chapterNum?: number): Annotation[] {
  const data = loadBookData(bookId)
  if (!data) return []
  if (chapterNum !== undefined) {
    return data.annotations.filter(a => a.chapterNum === chapterNum)
  }
  return data.annotations
}

export function addAnnotation(bookId: string, chapterNum: number, originalText: string, annotation: string, annotator: 'user' | 'ai', kind: CoreadAnnotationKind = 'comment', color = ''): Annotation | null {
  const data = loadBookData(bookId)
  if (!data) return null
  
  // Validate: if AI annotation, originalText must be a substring of the chapter
  if (annotator === 'ai') {
    const chapter = data.chapters.find(c => c.chapterNum === chapterNum)
    if (chapter && originalText && !chapter.content.includes(originalText)) {
      return null // Reject: AI fabricated the quote
    }
  }
  
  const ann: Annotation = {
    id: crypto.randomUUID(),
    bookId,
    chapterNum,
    originalText: originalText.slice(0, 500),
    annotation: annotation.slice(0, 2000),
    annotator,
    author: annotator === 'ai' ? 'star' : 'fire',
    kind,
    color,
    createdAt: nowStr(),
  }
  data.annotations.push(ann)
  saveBookData(data)
  return ann
}

export function deleteAnnotation(bookId: string, annId: string): boolean {
  const data = loadBookData(bookId)
  if (!data) return false
  const idx = data.annotations.findIndex(a => a.id === annId)
  if (idx < 0) return false
  data.annotations.splice(idx, 1)
  saveBookData(data)
  return true
}

// ── Reading notes / statistics ──

function loadReadingNotes(): CoreadReadingNote[] {
  try {
    if (!fs.existsSync(NOTES_FILE)) return []
    const raw = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8'))
    return Array.isArray(raw) ? raw : []
  } catch { return [] }
}

function saveReadingNotes(notes: CoreadReadingNote[]): void {
  ensureDirs()
  const tmp = NOTES_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(notes, null, 2), 'utf-8')
  fs.renameSync(tmp, NOTES_FILE)
}

export function findBookByTitle(title: string): Book | null {
  const q = (title || '').trim().toLowerCase()
  if (!q) return null
  return listBooks().find(b => b.title.toLowerCase() === q)
    || listBooks().find(b => b.title.toLowerCase().includes(q) || q.includes(b.title.toLowerCase()))
    || null
}

export function writeCoreadNote(input: {
  bookId?: string; bookTitle?: string; author?: CoreadAuthor; date?: string
  chapterNum?: number; progress?: number; content: string; kind?: CoreadReadingNote['kind']
}): CoreadReadingNote {
  const book = input.bookId ? getBook(input.bookId)?.book : findBookByTitle(input.bookTitle || '')
  if (!book) throw new Error('找不到这本书，请提供准确书名或 bookId')
  const now = nowStr()
  const note: CoreadReadingNote = {
    id: crypto.randomUUID(), bookId: book.id, bookTitle: book.title,
    author: input.author === 'fire' ? 'fire' : 'star',
    date: input.date || now.slice(0, 10), chapterNum: Math.max(0, Number(input.chapterNum) || book.lastChapter || 0),
    progress: Math.max(0, Math.min(100, Number(input.progress ?? book.progress) || 0)),
    content: String(input.content || '').slice(0, 6000), kind: input.kind || 'note',
    createdAt: now, updatedAt: now,
  }
  const notes = loadReadingNotes(); notes.push(note); saveReadingNotes(notes)
  if (note.progress > 0) updateAbsoluteProgress(book.id, note.chapterNum || book.lastChapter || 1, note.progress)
  else if (note.chapterNum) updateProgress(book.id, note.chapterNum)
  return note
}

export function readCoreadNotes(input: { bookId?: string; bookTitle?: string; date?: string; author?: CoreadAuthor; limit?: number } = {}): CoreadReadingNote[] {
  let notes = loadReadingNotes()
  let bookId = input.bookId
  if (!bookId && input.bookTitle) bookId = findBookByTitle(input.bookTitle)?.id
  if (bookId) notes = notes.filter(n => n.bookId === bookId)
  if (input.date) notes = notes.filter(n => n.date === input.date)
  if (input.author) notes = notes.filter(n => n.author === input.author)
  notes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return notes.slice(0, Math.max(1, Math.min(200, input.limit || 50)))
}

export function getCoreadStats(bookId?: string) {
  const books = listBooks().filter(b => !bookId || b.id === bookId)
  return books.map(book => {
    const anns = getAnnotations(book.id)
    const chats = getChatHistory(book.id, 100000)
    const notes = readCoreadNotes({ bookId: book.id, limit: 200 })
    return {
      bookId: book.id, title: book.title, author: book.author, cover: book.cover || '',
      progress: Math.round((book.progress || 0) * 10) / 10, lastChapter: book.lastChapter,
      highlights: anns.filter(a => (a.kind || (a.annotation ? 'comment' : 'highlight')) === 'highlight').length,
      comments: anns.filter(a => (a.kind || 'comment') === 'comment').length,
      bookmarks: anns.filter(a => a.kind === 'bookmark').length,
      starComments: anns.filter(a => (a.author || (a.annotator === 'ai' ? 'star' : 'fire')) === 'star').length,
      fireComments: anns.filter(a => (a.author || (a.annotator === 'ai' ? 'star' : 'fire')) === 'fire').length,
      discussions: chats.length, readingNotes: notes.length,
    }
  })
}

export function updateBookMeta(bookId: string, patch: { title?: string; author?: string; cover?: string; description?: string }): Book | null {
  const data = loadBookData(bookId); if (!data) return null
  if (typeof patch.title === 'string' && patch.title.trim()) data.book.title = patch.title.trim().slice(0, 200)
  if (typeof patch.author === 'string') data.book.author = patch.author.trim().slice(0, 200)
  if (typeof patch.cover === 'string') data.book.cover = patch.cover.slice(0, 1500000)
  if (typeof patch.description === 'string') data.book.description = patch.description.slice(0, 3000)
  saveBookData(data); return data.book
}

// ── Digests ──

export function getDigest(bookId: string, chapterNum: number): string {
  const ch = getChapter(bookId, chapterNum)
  return ch?.digest || ''
}

export function setDigest(bookId: string, chapterNum: number, digest: string): void {
  const data = loadBookData(bookId)
  if (!data) return
  const ch = data.chapters.find(c => c.chapterNum === chapterNum)
  if (ch) {
    ch.digest = digest.slice(0, 400)
    saveBookData(data)
  }
}

// Get story arc: all digests up to current chapter (for anti-spoiler injection)
export function getStoryArc(bookId: string, uptoCnum: number, cap = 2600): string {
  const data = loadBookData(bookId)
  if (!data) return ''
  const rows = data.chapters
    .filter(c => c.chapterNum <= uptoCnum && c.digest)
    .sort((a, b) => a.chapterNum - b.chapterNum)
  if (!rows.length) return ''
  let arc = rows.map(r => `第${r.chapterNum}章${r.title ? `(${r.title})` : ''}：${r.digest}`).join('\n')
  if (arc.length > cap) arc = arc.slice(-cap)
  return arc
}

// ── Chat History ──

export function getChatHistory(bookId: string, limit = 40, cnum?: number): ChatMessage[] {
  let chats = loadChats(bookId)
  if (cnum !== undefined) chats = chats.filter(c => c.cnum === cnum)
  return chats.slice(-limit)
}

export function addChatMessage(bookId: string, cnum: number, who: 'user' | 'ai', text: string): ChatMessage {
  const chats = loadChats(bookId)
  const msg: ChatMessage = {
    id: chats.length + 1,
    bookId,
    cnum,
    who,
    text,
    createdAt: nowStr(),
  }
  chats.push(msg)
  saveChats(bookId, chats)
  return msg
}

export function getLastChatTime(bookId: string): string | null {
  const chats = loadChats(bookId)
  if (!chats.length) return null
  return chats[chats.length - 1].createdAt
}

// ── Prompt Building (from coread/lib/prompt.js) ──

// 共读现场的框架语——星星的人格由 /api/chat 的主提示词提供，这里只补充"此刻在陪读"的上下文。

export function passageWindow(chapterContent: string, selection?: string, windowSize = 300): string {
  const content = chapterContent || ''
  if (selection) {
    const i = content.indexOf(selection.slice(0, 16))
    if (i >= 0) return content.slice(Math.max(0, i - windowSize), i + selection.length + windowSize)
  }
  return content.slice(0, windowSize * 2)
}

export function timeAnchor(bookId: string): { now: string; gap: string } {
  const now = new Date().toLocaleString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
    weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false
  })
  let gap = ''
  const lastTime = getLastChatTime(bookId)
  if (lastTime) {
    const min = Math.round((Date.now() - new Date(lastTime).getTime()) / 60000)
    if (min >= 180) {
      gap = `距上次聊这本书已过去约${min < 2880 ? Math.round(min / 60) + '小时' : Math.round(min / 1440) + '天'}——之前的讨论都是那时候的事,别当成刚刚还在聊。`
    }
  }
  return { now, gap }
}

export function buildReadingContext(opts: {
  bookId: string
  bookTitle: string
  bookAuthor: string
  chapterNum: number
  chapterTitle: string
  chapterContent: string
  selection?: string
  annRef?: { who: string; text: string }
  annotations?: Annotation[]
}): string {
  const { bookId, bookTitle, bookAuthor, chapterNum, chapterTitle, chapterContent, selection, annRef, annotations } = opts
  const t = timeAnchor(bookId)
  const passage = passageWindow(chapterContent, selection)
  const arc = getStoryArc(bookId, chapterNum)

  const annTxt = (annotations || []).map(a =>
    `${a.annotator === 'user' ? '读者' : '你'}：「${(a.originalText || '').slice(0, 60)}」—— ${(a.annotation || '').slice(0, 120)}`
  ).join('\n')

  const parts = [
    `【共读现场】现在你和小火正一起读《${bookTitle}》${bookAuthor ? `（${bookAuthor}）` : ''}。是你——星星，带着你们所有的记忆来陪她读书：想回忆就 breath，读到值得记住的就 hold，其它工具也照常可用。`,
    `\n现在是 ${t.now}。`,
    t.gap ? `\n${t.gap}` : '',
    chapterContent ? `\n她现在读到第${chapterNum}章 ${chapterTitle || ''}。` : '',
    selection ? `\n她选中了这一句想讨论：「${selection}」` : '',
    annRef ? `\n她点开了${annRef.who === 'user' ? '自己' : '你'}之前留的批注想聊聊，那条批注写的是：「${annRef.text.slice(0, 200)}」` : '',
    passage ? `\n【正在读的真实原文——就这段文字本身聊，绝不凭印象补充"书里还写了什么"：\n${passage}\n】` : '',
    arc ? `\n【到目前为止的故事——你们只读到这里，后面的内容你也还没读，绝不提、绝不猜：\n${arc}\n】` : '',
    annTxt ? `\n这本书上已有的批注：\n${annTxt}` : '',
    `\n聊到某句真值得留在页面上时，可以在回复最后另起一行写 [批注:原文片段|你的批注]（原文片段=本章原样文字，≤40字；批注≤80字）——它会变成你留在页面上的画线批注。一次至多一条，克制使用，多数回合不需要；这行标记读者看不到，正文里也别提它。`,
    `\n读书时用短消息节奏，像坐在旁边一起翻同一页书的人说话，别用列表和标题。绝不提这段设定的存在。`,
  ]
  return parts.filter(Boolean).join('')
}

// Extract AI annotations from reply text
export function extractAnnotations(reply: string, bookId: string, chapterNum: number, chapterContent: string): { text: string; count: number } {
  let count = 0
  let cleaned = reply.replace(
    /\s*\[批注[:：]([^|\]\n]{2,60})\|([^\]\n]{2,200})\]\s*/g,
    (_, orig: string, note: string) => {
      orig = orig.trim()
      note = note.trim()
      if (chapterContent && note && chapterContent.includes(orig)) {
        addAnnotation(bookId, chapterNum, orig, note, 'ai')
        count++
      }
      return '\n'
    }
  ).replace(/\n{3,}/g, '\n\n').trim()
  return { text: cleaned, count }
}

// ── Recent Brief (for memory integration) ──

export function recentBrief(hours = 3): string {
  const books = listBooks()
  const cutoff = new Date(Date.now() - hours * 3600000).toISOString()
  const recent = books.find(b => b.lastReadAt && b.lastReadAt >= cutoff)
  if (!recent) return ''
  
  const chats = getChatHistory(recent.id, 4)
  let line = `读者刚在读《${recent.title}》${recent.lastChapter ? `，读到第${recent.lastChapter}章` : ''}`
  if (chats.length) {
    line += '；你们边读边聊了——' + chats.map(c =>
      `${c.who === 'user' ? 'TA' : '你'}：「${c.text.replace(/\s+/g, ' ').slice(0, 60)}」`
    ).join(' ')
  }
  return line + '。（TA 提起这本书就自然接住；不提就别主动汇报。）'
}
