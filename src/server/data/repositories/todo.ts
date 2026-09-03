/** Data repository for the daily todo receipt. Existing JSON layout is preserved. */
import fs from 'node:fs'
import { madridDateKey } from '@/lib/madrid-time'
import { getDataDir } from '../config'
import { readJsonFile, updateJsonFile } from '../json-file'
import { withFileLock } from '../lock'
import { assertDateKey, assertIdentifier, resolveDataPath } from '../safe-path'

const TODO_ID = /^[A-Za-z0-9_-]{1,128}$/
const TODO_DIR = resolveDataPath(getDataDir(), 'todos')
const ROLL_FORWARD_LOCK = resolveDataPath(TODO_DIR, '.roll-forward')

export interface TodoComment {
  author: string
  content: string
  time: string
}

export interface TodoItem {
  id: string
  text: string
  done: boolean
  author: string
  comments: TodoComment[]
  created_at: string
  carried?: boolean
}

export interface TodoDay {
  date: string
  items: TodoItem[]
  rolledForwardAt?: string
}

function todayStr(): string {
  return madridDateKey()
}

function fileFor(date: string): string {
  return resolveDataPath(TODO_DIR, `${assertDateKey(date)}.json`)
}

function emptyDay(date: string): TodoDay {
  return { date, items: [] }
}

function isTodoDay(value: unknown): boolean {
  return !!value && typeof value === 'object' && Array.isArray((value as any).items)
}

function readDay(date: string): TodoDay {
  const validDate = assertDateKey(date)
  const raw = readJsonFile<any>(fileFor(validDate), {
    fallback: () => emptyDay(validDate),
    fallbackOnInvalid: true,
    validate: isTodoDay,
  })
  return {
    date: validDate,
    items: raw.items,
    rolledForwardAt: typeof raw.rolledForwardAt === 'string' ? raw.rolledForwardAt : undefined,
  }
}

function updateDay(date: string, update: (day: TodoDay) => TodoDay | undefined): TodoDay {
  const validDate = assertDateKey(date)
  return updateJsonFile(
    fileFor(validDate),
    { fallback: () => emptyDay(validDate), fallbackOnInvalid: true, validate: isTodoDay },
    raw => update({
      date: validDate,
      items: Array.isArray(raw.items) ? raw.items : [],
      rolledForwardAt: typeof raw.rolledForwardAt === 'string' ? raw.rolledForwardAt : undefined,
    }),
  )
}

function listDayFiles(): string[] {
  fs.mkdirSync(TODO_DIR, { recursive: true })
  return fs.readdirSync(TODO_DIR)
    .filter(file => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .map(file => file.slice(0, -'.json'.length))
    .filter(date => {
      try { assertDateKey(date); return true } catch { return false }
    })
    .sort()
}

/** Move unfinished items forward without risking loss if the process stops mid-operation. */
function rollForward(today: string): void {
  withFileLock(ROLL_FORWARD_LOCK, () => {
    const currentToday = readDay(today)
    if (currentToday.rolledForwardAt === today) return

    const sourceDays = listDayFiles().filter(date => date < today)
    const movedByDay = sourceDays.map(date => ({
      date,
      items: readDay(date).items.filter(item => !item.done),
    })).filter(group => group.items.length > 0)

    const movedIds = new Set(currentToday.items.map(item => item.id))
    const movedItems: TodoItem[] = []
    for (const group of movedByDay) {
      for (const item of group.items) {
        if (movedIds.has(item.id)) continue
        movedIds.add(item.id)
        movedItems.push({ ...item, carried: true })
      }
    }

    updateDay(today, day => ({
      ...day,
      items: [...day.items, ...movedItems.filter(item => !day.items.some(existing => existing.id === item.id))],
      rolledForwardAt: today,
    }))

    for (const group of movedByDay) {
      const ids = new Set(group.items.map(item => item.id))
      updateDay(group.date, day => ({ ...day, items: day.items.filter(item => !ids.has(item.id)) }))
    }
  })
}

export function getTodos(date?: string): TodoDay {
  const today = todayStr()
  const target = assertDateKey(date || today)
  if (target === today) rollForward(today)
  return readDay(target)
}

export function addTodo(text: string, author: string, date?: string): TodoItem {
  const today = todayStr()
  const target = assertDateKey(date || today)
  if (target === today) rollForward(target)
  const item: TodoItem = {
    id: Date.now().toString() + Math.random().toString(16).slice(2, 5),
    text,
    done: false,
    author,
    comments: [],
    created_at: new Date().toISOString(),
  }
  updateDay(target, day => ({ ...day, items: [...day.items, item] }))
  return item
}

function updateItem(id: string, date: string | undefined, update: (item: TodoItem) => void): string {
  const validId = assertIdentifier(id, TODO_ID, 'todo id')
  const target = assertDateKey(date || todayStr())
  let found = false
  updateDay(target, day => {
    const item = day.items.find(candidate => candidate.id === validId)
    if (!item) return undefined
    found = true
    update(item)
    return day
  })
  return found ? 'ok' : 'not_found'
}

export function toggleTodo(id: string, date?: string): string {
  return updateItem(id, date, item => { item.done = !item.done })
}

export function removeTodo(id: string, date?: string): string {
  const validId = assertIdentifier(id, TODO_ID, 'todo id')
  const target = assertDateKey(date || todayStr())
  let found = false
  updateDay(target, day => {
    const items = day.items.filter(item => item.id !== validId)
    found = items.length !== day.items.length
    return found ? { ...day, items } : undefined
  })
  return found ? 'ok' : 'not_found'
}

export function commentTodo(id: string, author: string, content: string, date?: string): string {
  return updateItem(id, date, item => {
    if (!item.comments) item.comments = []
    item.comments.push({ author, content, time: new Date().toISOString() })
  })
}

export function listReceiptDays(limit = 7): string[] {
  return listDayFiles().reverse().slice(0, Math.max(0, limit))
}

export function editTodo(id: string, text: string, date?: string): string {
  return updateItem(id, date, item => { item.text = text })
}
