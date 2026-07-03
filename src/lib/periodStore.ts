// 生理期记录 — local persist
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface PeriodRecord {
  id: string
  start: string // yyyy-MM-dd
  end?: string
}

interface PeriodStore {
  records: PeriodRecord[]
  startPeriod: (date: string) => void
  endPeriod: (date: string) => void
  deleteRecord: (id: string) => void
}

export const usePeriodStore = create<PeriodStore>()(
  persist(
    (set) => ({
      records: [],
      startPeriod: (date) =>
        set((s) => ({
          records: [...s.records, { id: Date.now().toString(), start: date }].sort((a, b) =>
            a.start.localeCompare(b.start)
          ),
        })),
      endPeriod: (date) =>
        set((s) => {
          const open = [...s.records].reverse().find((r) => !r.end)
          if (!open) return s
          return { records: s.records.map((r) => (r.id === open.id ? { ...r, end: date } : r)) }
        }),
      deleteRecord: (id) => set((s) => ({ records: s.records.filter((r) => r.id !== id) })),
    }),
    { name: 'starfire-period' }
  )
)
