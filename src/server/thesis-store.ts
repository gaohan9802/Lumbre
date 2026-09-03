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
import { madridDateKey } from '@/lib/madrid-time'
import { readThesisState, updateThesisState } from './data/repositories/thesis'

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

function todayStr(): string { return madridDateKey() }

function emptyState(): ThesisState { return { chapters: [], comments: [], progress: [] } }

function normalizeState(raw: ThesisState): ThesisState {
  return {
    chapters: Array.isArray(raw?.chapters)
      ? raw.chapters.filter(value => (
        !!value
        && typeof value === 'object'
        && typeof value.id === 'string'
        && typeof value.title === 'string'
        && typeof value.totalPages === 'number'
        && typeof value.currentPages === 'number'
      ))
      : [],
    comments: Array.isArray(raw?.comments)
      ? raw.comments.filter(value => !!value && typeof value === 'object' && typeof value.id === 'string' && typeof value.content === 'string')
      : [],
    progress: Array.isArray(raw?.progress)
      ? raw.progress.filter(value => !!value && typeof value === 'object' && typeof value.date === 'string')
      : [],
  }
}

function readState(): ThesisState {
  return normalizeState(readThesisState(emptyState))
}

function mutateState<T>(mutation: (state: ThesisState) => { result: T; write: boolean }): T {
  let result!: T
  updateThesisState(emptyState, raw => {
    const state = normalizeState(raw)
    const outcome = mutation(state)
    result = outcome.result
    return outcome.write ? state : undefined
  })
  return result
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
  return mutateState(state => {
    const now = new Date().toISOString()
    const chapter: ThesisChapter = {
      id: genId(),
      title: title.trim() || '未命名章节',
      totalPages: Math.max(0, Math.round(totalPages) || 0),
      currentPages: 0,
      created_at: now,
      updated_at: now,
    }
    state.chapters.push(chapter)
    recordProgress(state)
    return { result: chapter, write: true }
  })
}

export function updateChapter(
  id: string,
  patch: { title?: string; totalPages?: number; currentPages?: number }
): string {
  return mutateState(state => {
    const chapter = state.chapters.find(value => value.id === id)
    if (!chapter) return { result: 'not_found', write: false }
    if (typeof patch.title === 'string') chapter.title = patch.title.trim() || chapter.title
    if (typeof patch.totalPages === 'number' && isFinite(patch.totalPages)) {
      chapter.totalPages = Math.max(0, Math.round(patch.totalPages))
    }
    if (typeof patch.currentPages === 'number' && isFinite(patch.currentPages)) {
      chapter.currentPages = clampPages(patch.currentPages, chapter.totalPages)
    } else {
      chapter.currentPages = clampPages(chapter.currentPages, chapter.totalPages)
    }
    chapter.updated_at = new Date().toISOString()
    recordProgress(state)
    return { result: 'ok', write: true }
  })
}

export function removeChapter(id: string): string {
  return mutateState(state => {
    const before = state.chapters.length
    state.chapters = state.chapters.filter(value => value.id !== id)
    if (state.chapters.length === before) return { result: 'not_found', write: false }
    recordProgress(state)
    return { result: 'ok', write: true }
  })
}

export function commentThesis(author: string, content: string): string {
  if (!content.trim()) return 'empty'
  return mutateState(state => {
    state.comments.push({
      id: genId(),
      author,
      content: content.trim(),
      time: new Date().toISOString(),
    })
    return { result: 'ok', write: true }
  })
}
