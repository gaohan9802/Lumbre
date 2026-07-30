/**
 * Local file-based storage for the daily todo "receipt".
 * One JSON file per day: DATA_DIR/todos/YYYY-MM-DD.json
 *
 * Rules:
 *  - Unresolved items are NOT cleared at midnight; they roll forward into today.
 *  - Receipts are kept for 7 days of display; older files are retained on disk
 *    (persistent) but not surfaced by listReceiptDays().
 *  - author: 'star' (🐆, written by AI) or 'fire' (🦦, written by user).
 */
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR || '/persistent'
const TODO_DIR = path.join(DATA_DIR, 'todos')

function ensureDir() {
  fs.mkdirSync(TODO_DIR, { recursive: true })
}

export interface TodoComment {
  author: string
  content: string
  time: string
}

export interface TodoItem {
  id: string
  text: string
  done: boolean
  author: string          // 'star' | 'fire'
  comments: TodoComment[]
  created_at: string
  carried?: boolean       // rolled over from a previous day
}

export interface TodoDay {
  date: string            // YYYY-MM-DD
  items: TodoItem[]
  rolledForwardAt?: string
}

function fileFor(date: string) {
  return path.join(TODO_DIR, `${date}.json`)
}

function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function readDay(date: string): TodoDay {
  ensureDir()
  try {
    const raw = JSON.parse(fs.readFileSync(fileFor(date), 'utf-8'))
    return { date, items: Array.isArray(raw.items) ? raw.items : [], rolledForwardAt: raw.rolledForwardAt }
  } catch {
    return { date, items: [] }
  }
}

function saveDay(day: TodoDay) {
  ensureDir()
  fs.writeFileSync(fileFor(day.date), JSON.stringify(day, null, 2), 'utf-8')
}

function listDayFiles(): string[] {
  ensureDir()
  return fs
    .readdirSync(TODO_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace('.json', ''))
    .sort()
}

/**
 * Roll all unresolved items from earlier days into today, exactly once per day.
 * Moves (not copies) undone items so they don't duplicate; the source day keeps
 * only its completed items as an accurate historical record.
 */
function rollForward(today: string) {
  const days = listDayFiles().filter((d) => d < today)
  if (days.length === 0) return
  const todayDay = readDay(today)
  if (todayDay.rolledForwardAt === today) return

  let moved = 0
  for (const d of days) {
    const past = readDay(d)
    const undone = past.items.filter((i) => !i.done)
    if (undone.length === 0) continue
    for (const item of undone) {
      todayDay.items.push({ ...item, carried: true })
      moved++
    }
    past.items = past.items.filter((i) => i.done)
    saveDay(past)
  }
  todayDay.rolledForwardAt = today
  saveDay(todayDay)
}

export function getTodos(date?: string): TodoDay {
  const today = todayStr()
  const target = date || today
  if (target === today) rollForward(today)
  return readDay(target)
}

export function addTodo(text: string, author: string, date?: string): TodoItem {
  const target = date || todayStr()
  const day = getTodos(target)
  const item: TodoItem = {
    id: Date.now().toString() + Math.random().toString(16).slice(2, 5),
    text,
    done: false,
    author,
    comments: [],
    created_at: new Date().toISOString(),
  }
  day.items.push(item)
  saveDay(day)
  return item
}

export function toggleTodo(id: string, date?: string): string {
  const day = getTodos(date)
  const item = day.items.find((i) => i.id === id)
  if (!item) return 'not_found'
  item.done = !item.done
  saveDay(day)
  return 'ok'
}

export function removeTodo(id: string, date?: string): string {
  const day = getTodos(date)
  const before = day.items.length
  day.items = day.items.filter((i) => i.id !== id)
  if (day.items.length === before) return 'not_found'
  saveDay(day)
  return 'ok'
}

export function commentTodo(id: string, author: string, content: string, date?: string): string {
  const day = getTodos(date)
  const item = day.items.find((i) => i.id === id)
  if (!item) return 'not_found'
  if (!item.comments) item.comments = []
  item.comments.push({ author, content, time: new Date().toISOString() })
  saveDay(day)
  return 'ok'
}

/** Recent receipt days (default 7) that actually have data, newest first. */
export function listReceiptDays(limit = 7): string[] {
  return listDayFiles().reverse().slice(0, limit)
}

export function editTodo(id: string, text: string, date?: string): string {
  const day = getTodos(date)
  const item = day.items.find((i) => i.id === id)
  if (!item) return 'not_found'
  item.text = text
  saveDay(day)
  return 'ok'
}
