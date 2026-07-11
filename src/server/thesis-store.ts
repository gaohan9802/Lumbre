/**
 * Local file-based storage for the thesis (Tesis) progress tracker.
 * Single JSON file: DATA_DIR/thesis/thesis.json
 *
 * Model:
 *  - chapters: each has a title, totalPages and currentPages → per-chapter %.
 *  - progress: one daily snapshot { date, done, total, percent } for the line chart.
 *              Re-recorded (upserted) whenever pages change, keyed by day.
 *  - comments: AI (or user) comments, only date + content (no tags).
 *      author: 'star' (🐆, AI) or 'fire' (🦦, user).
 */
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR || '/persistent'
const THESIS_DIR = path.join(DATA_DIR, 'thesis')
const THESIS_FILE = path.join(THESIS_DIR, 'thesis.json')

function ensureDir() {
  fs.mkdirSync(THESIS_DIR, { recursive: true })
}

export interface ThesisChapter {
  id: string
  title: string
  totalPages: number
  currentPages: number
  created_at: string
  updated_at: string
}

export interface ThesisComment {
  id: string
  author: string          // 'star' | 'fire'
  content: string
  time: string
}

export interface ProgressPoint {
  date: string            // YYYY-MM-DD
  done: number            // sum of currentPages across chapters
  total: number           // sum of totalPages across chapters
  percent: number
}

export interface ThesisState {
  chapters: ThesisChapter[]
  comments: ThesisComment[]
  progress: ProgressPoint[]
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(16).slice(2, 6)
}

function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function readState(): ThesisState {
  ensureDir()
  try {
    const raw = JSON.parse(fs.readFileSync(THESIS_FILE, 'utf-8'))
    return {
      chapters: Array.isArray(raw.chapters) ? raw.chapters : [],
      comments: Array.isArray(raw.comments) ? raw.comments : [],
      progress: Array.isArray(raw.progress) ? raw.progress : [],
    }
  } catch {
    return { chapters: [], comments: [], progress: [] }
  }
}

function saveState(s: ThesisState) {
  ensureDir()
  fs.writeFileSync(THESIS_FILE, JSON.stringify(s, null, 2), 'utf-8')
}

/** Upsert today's snapshot from the current chapters. */
function recordProgress(s: ThesisState) {
  const done = s.chapters.reduce((a, c) => a + (c.currentPages || 0), 0)
  const total = s.chapters.reduce((a, c) => a + (c.totalPages || 0), 0)
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  const today = todayStr()
  const point: ProgressPoint = { date: today, done, total, percent }
  const idx = s.progress.findIndex((p) => p.date === today)
  if (idx >= 0) s.progress[idx] = point
  else s.progress.push(point)
  s.progress.sort((a, b) => a.date.localeCompare(b.date))
}

function clampPages(cur: number, total: number): number {
  if (!isFinite(cur) || cur < 0) return 0
  if (total > 0 && cur > total) return total
  return Math.round(cur)
}

/** Full state plus computed aggregates. */
export function getThesis() {
  const s = readState()
  const done = s.chapters.reduce((a, c) => a + (c.currentPages || 0), 0)
  const total = s.chapters.reduce((a, c) => a + (c.totalPages || 0), 0)
  const percent = total > 0 ? Math.round((done / total) * 100) : 0
  return {
    chapters: s.chapters,
    comments: s.comments,
    progress: s.progress,
    totals: { done, total, percent },
  }
}

export function addChapter(title: string, totalPages: number): ThesisChapter {
  const s = readState()
  const now = new Date().toISOString()
  const chapter: ThesisChapter = {
    id: genId(),
    title: title.trim() || '未命名章节',
    totalPages: Math.max(0, Math.round(totalPages) || 0),
    currentPages: 0,
    created_at: now,
    updated_at: now,
  }
  s.chapters.push(chapter)
  recordProgress(s)
  saveState(s)
  return chapter
}

export function updateChapter(
  id: string,
  patch: { title?: string; totalPages?: number; currentPages?: number }
): string {
  const s = readState()
  const c = s.chapters.find((x) => x.id === id)
  if (!c) return 'not_found'
  if (typeof patch.title === 'string') c.title = patch.title.trim() || c.title
  if (typeof patch.totalPages === 'number' && isFinite(patch.totalPages)) {
    c.totalPages = Math.max(0, Math.round(patch.totalPages))
  }
  if (typeof patch.currentPages === 'number' && isFinite(patch.currentPages)) {
    c.currentPages = clampPages(patch.currentPages, c.totalPages)
  } else {
    // totalPages may have shrunk below currentPages
    c.currentPages = clampPages(c.currentPages, c.totalPages)
  }
  c.updated_at = new Date().toISOString()
  recordProgress(s)
  saveState(s)
  return 'ok'
}

export function removeChapter(id: string): string {
  const s = readState()
  const before = s.chapters.length
  s.chapters = s.chapters.filter((x) => x.id !== id)
  if (s.chapters.length === before) return 'not_found'
  recordProgress(s)
  saveState(s)
  return 'ok'
}

export function commentThesis(author: string, content: string): string {
  if (!content.trim()) return 'empty'
  const s = readState()
  s.comments.push({
    id: genId(),
    author,
    content: content.trim(),
    time: new Date().toISOString(),
  })
  saveState(s)
  return 'ok'
}
