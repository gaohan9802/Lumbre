'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Check, ChevronLeft, ChevronRight, Pencil, Plus, X } from 'lucide-react'
import { habits as habitApi } from '@/lib/api'
import { addMadridDays, madridDateKey, madridIsoWeekday } from '@/lib/madrid-time'
import { useTheme } from '@/lib/theme'

interface Habit { id: string; name: string; completed_dates: string[] }

const weekday = ['一', '二', '三', '四', '五', '六', '日']
const weekStart = (day: string) => addMadridDays(day, 1 - madridIsoWeekday(`${day}T12:00:00Z`))
const dayNumber = (day: string) => Number(day.slice(-2))
const monthDays = (year: number, month: number) => {
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  return { offset: madridIsoWeekday(`${first}T12:00:00Z`) - 1, days: Array.from({ length: count }, (_, index) => `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`) }
}

export function HabitTrackerView() {
  const night = useTheme(state => state.theme === 'night')
  const today = madridDateKey()
  const [start, setStart] = useState(weekStart(today))
  const [habits, setHabits] = useState<Habit[]>([])
  const [newName, setNewName] = useState('')
  const [yearOpen, setYearOpen] = useState(false)
  const [yearHabitId, setYearHabitId] = useState('')
  const [error, setError] = useState('')
  const days = useMemo(() => Array.from({ length: 7 }, (_, index) => addMadridDays(start, index)), [start])
  const load = useCallback(async () => {
    try {
      const data = await habitApi.list()
      setHabits(data.habits || [])
      setYearHabitId(current => data.habits?.some((habit: Habit) => habit.id === current) ? current : data.habits?.[0]?.id || '')
      setError('')
    } catch (cause: any) { setError(cause?.message || '习惯加载失败') }
  }, [])
  useEffect(() => { void load() }, [load])

  const create = async () => {
    if (!newName.trim()) return
    try { await habitApi.act('create', { name: newName.trim() }); setNewName(''); await load() }
    catch (cause: any) { setError(cause?.message || '新建失败') }
  }
  const toggle = async (habit: Habit, date: string) => {
    if (date > today) return
    setHabits(current => current.map(item => item.id === habit.id ? { ...item, completed_dates: item.completed_dates.includes(date) ? item.completed_dates.filter(value => value !== date) : [...item.completed_dates, date] } : item))
    try { await habitApi.act('toggle', { id: habit.id, date }); setError('') }
    catch (cause: any) { setError(cause?.message || '打卡失败'); await load() }
  }
  const rename = async (habit: Habit) => {
    const value = window.prompt('修改习惯名称', habit.name)?.trim()
    if (!value || value === habit.name) return
    try { await habitApi.act('rename', { id: habit.id, name: value }); await load() }
    catch (cause: any) { setError(cause?.message || '修改失败') }
  }
  const archive = async (habit: Habit) => {
    if (!window.confirm(`归档“${habit.name}”吗？已有打卡记录会保留。`)) return
    try { await habitApi.act('archive', { id: habit.id }); await load() }
    catch (cause: any) { setError(cause?.message || '归档失败') }
  }
  const year = Number(today.slice(0, 4))
  const yearHabit = habits.find(habit => habit.id === yearHabitId)
  const completed = new Set(yearHabit?.completed_dates || [])

  return <div className="receipt-stage pointer-events-none flex h-full w-full items-center justify-center p-4">
    <div className={`receipt-ticket pointer-events-auto relative max-h-[92dvh] w-full max-w-2xl overflow-y-auto p-5 font-receipt sm:p-6 ${night ? 'receipt-ticket-night todo-receipt-night' : ''}`}>
      <header className="relative text-center">
        <button onClick={() => setYearOpen(true)} className="absolute right-0 top-0 rounded border border-receipt-stamp/35 px-2 py-1 text-[9px] font-bold tracking-[.12em] text-receipt-stamp">全年</button>
        <h2 className="text-[21px] font-bold tracking-[.08em] text-receipt-ink">Habit Tracker</h2>
        <p className="receipt-ticket-accent mt-1 text-[10px] font-bold tracking-[.12em]">{start.replaceAll('-', ' / ')} — {days[6].slice(5).replace('-', ' / ')}</p>
      </header>

      <div className="receipt-ticket-rule my-4" />
      <div className="mb-3 grid grid-cols-[minmax(7rem,1fr)_repeat(7,minmax(1.9rem,2.5rem))] items-end gap-1">
        <div className="flex items-center gap-1">
          <button aria-label="上一周" onClick={() => setStart(value => addMadridDays(value, -7))} className="rounded p-1 text-receipt-ink/45"><ChevronLeft size={14}/></button>
          <button onClick={() => setStart(weekStart(today))} className="text-[9px] text-receipt-ink/50">本周</button>
          <button aria-label="下一周" onClick={() => setStart(value => addMadridDays(value, 7))} className="rounded p-1 text-receipt-ink/45"><ChevronRight size={14}/></button>
        </div>
        {days.map((day, index) => <div key={day} className={`text-center ${day === today ? 'text-receipt-stamp' : 'text-receipt-ink/55'}`}><div className="text-[8px]">周{weekday[index]}</div><div className="mt-0.5 text-[11px] font-bold">{dayNumber(day)}</div></div>)}
      </div>

      <div className="space-y-1.5">
        {habits.map(habit => <div key={habit.id} className="group grid grid-cols-[minmax(7rem,1fr)_repeat(7,minmax(1.9rem,2.5rem))] items-center gap-1 border-b border-dashed border-receipt-line py-2">
          <div className="flex min-w-0 items-center gap-1 pr-2"><span className="min-w-0 flex-1 truncate text-xs text-receipt-ink">{habit.name}</span><button aria-label={`修改 ${habit.name}`} onClick={() => void rename(habit)} className="opacity-35 transition sm:opacity-0 sm:group-hover:opacity-35 focus:opacity-50"><Pencil size={10}/></button><button aria-label={`归档 ${habit.name}`} onClick={() => void archive(habit)} className="opacity-35 transition sm:opacity-0 sm:group-hover:opacity-35 focus:opacity-50"><Archive size={10}/></button></div>
          {days.map(day => { const checked = habit.completed_dates.includes(day); return <button key={day} disabled={day > today} aria-label={`${habit.name} ${day} ${checked ? '取消打卡' : '打卡'}`} onClick={() => void toggle(habit, day)} className={`mx-auto grid h-7 w-7 place-items-center rounded border transition ${checked ? 'border-receipt-stamp bg-receipt-stamp text-white' : 'border-receipt-ink/20'} disabled:opacity-20`}>{checked && <Check size={13}/>}</button> })}
        </div>)}
        {!habits.length && <p className="py-10 text-center text-xs text-receipt-ink/35">写下第一个想慢慢养成的习惯</p>}
      </div>

      <div className="mt-5 flex gap-2 border-t border-dashed border-receipt-line pt-4"><input value={newName} onChange={event => setNewName(event.target.value)} onKeyDown={event => event.key === 'Enter' && void create()} placeholder="新习惯" className="min-w-0 flex-1 border-b border-dashed border-receipt-line bg-transparent px-1 py-2 text-xs text-receipt-ink outline-none"/><button aria-label="添加习惯" onClick={() => void create()} className="text-receipt-stamp"><Plus size={16}/></button></div>
      {error && <p role="alert" className="mt-3 text-center text-[10px] text-red-500">{error}</p>}

      {yearOpen && <div className="absolute inset-0 z-10 overflow-y-auto bg-[var(--receipt-paper)] p-5 sm:p-6"><div className="flex items-center"><div><h3 className="text-lg font-bold text-receipt-ink">{year} · 全年</h3><p className="mt-1 text-[9px] text-receipt-ink/40">一年慢慢积起来的痕迹</p></div><button aria-label="关闭全年视图" onClick={() => setYearOpen(false)} className="ml-auto text-receipt-ink/45"><X size={17}/></button></div>{yearHabit ? <><select value={yearHabitId} onChange={event => setYearHabitId(event.target.value)} className="mt-4 w-full border-b border-dashed border-receipt-line bg-transparent py-2 text-xs text-receipt-ink outline-none">{habits.map(habit => <option key={habit.id} value={habit.id}>{habit.name}</option>)}</select><div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3">{Array.from({ length: 12 }, (_, index) => { const month = monthDays(year, index + 1); return <section key={index}><h4 className="mb-2 text-center text-[10px] font-bold text-receipt-ink/55">{index + 1} 月</h4><div className="grid grid-cols-7 gap-1">{Array.from({ length: month.offset }, (_, blank) => <span key={`b-${blank}`}/>) }{month.days.map(day => <span key={day} title={day} className={`aspect-square rounded-[2px] ${completed.has(day) ? 'bg-receipt-stamp' : 'bg-receipt-ink/10'}`}/>)}</div></section> })}</div></> : <p className="py-16 text-center text-xs text-receipt-ink/35">还没有习惯记录</p>}</div>}
    </div>
  </div>
}
