import { randomUUID } from 'node:crypto'
import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { assertDateKey, assertIdentifier, resolveDataPath } from './data/safe-path'
import { madridDateKey } from '@/lib/madrid-time'

export interface Habit {
  id: string
  name: string
  archived: boolean
  completed_dates: string[]
  created_at: string
  updated_at: string
}

interface HabitData { habits: Habit[] }

const FILE = resolveDataPath(getDataDir(), 'habits', 'tracker.json')
const ID = /^[A-Za-z0-9_-]{1,128}$/
const validHabitData = (value: unknown): value is HabitData => !!value && typeof value === 'object' && Array.isArray((value as HabitData).habits)
  && (value as HabitData).habits.every(habit => !!habit && typeof habit.id === 'string' && typeof habit.name === 'string'
    && typeof habit.archived === 'boolean' && Array.isArray(habit.completed_dates) && habit.completed_dates.every(date => typeof date === 'string'))
const options = {
  fallback: (): HabitData => ({ habits: [] }),
  fallbackOnInvalid: true,
  validate: validHabitData,
}
const name = (value: unknown) => String(value || '').trim().slice(0, 60)

export function listHabits(includeArchived = false): Habit[] {
  return readJsonFile(FILE, options).habits.filter(habit => includeArchived || !habit.archived)
}

export function habitContext(value: Date | number | string = new Date()): string {
  const today = madridDateKey(value)
  const yearPrefix = `${today.slice(0, 4)}-`
  const habits = listHabits()
  const todayNames = habits.filter(habit => habit.completed_dates.includes(today)).map(habit => habit.name)
  const totals = habits.map(habit => `${habit.name} ${habit.completed_dates.filter(date => date.startsWith(yearPrefix)).length} 次`)
  return `今日打卡：${todayNames.join('、') || '暂无'}\n全年打卡：${totals.join('、') || '暂无'}`
}

export function createHabit(nameValue: unknown): Habit {
  const habitName = name(nameValue)
  if (!habitName) throw new Error('习惯名称不能为空')
  const at = new Date().toISOString()
  const habit: Habit = { id: randomUUID(), name: habitName, archived: false, completed_dates: [], created_at: at, updated_at: at }
  updateJsonFile(FILE, options, data => {
    if (data.habits.filter(item => !item.archived).length >= 30) throw new Error('最多保留 30 个进行中的习惯')
    data.habits.push(habit)
    return data
  })
  return habit
}

function updateHabit(idValue: unknown, update: (habit: Habit) => void): Habit {
  const id = assertIdentifier(String(idValue || ''), ID, 'habit id')
  let saved!: Habit
  updateJsonFile(FILE, options, data => {
    const habit = data.habits.find(item => item.id === id)
    if (!habit) throw new Error('习惯不存在')
    update(habit)
    habit.updated_at = new Date().toISOString()
    saved = habit
    return data
  })
  return saved
}

export function renameHabit(id: unknown, nameValue: unknown): Habit {
  const habitName = name(nameValue)
  if (!habitName) throw new Error('习惯名称不能为空')
  return updateHabit(id, habit => { habit.name = habitName })
}

export function archiveHabit(id: unknown): Habit {
  return updateHabit(id, habit => { habit.archived = true })
}

export function toggleHabit(id: unknown, dateValue: unknown): Habit {
  const date = assertDateKey(String(dateValue || ''))
  if (date > madridDateKey()) throw new Error('不能提前打未来的卡')
  return updateHabit(id, habit => {
    const dates = new Set(Array.isArray(habit.completed_dates) ? habit.completed_dates : [])
    if (dates.has(date)) dates.delete(date)
    else dates.add(date)
    habit.completed_dates = Array.from(dates).sort()
  })
}
