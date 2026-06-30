// Theme store using zustand
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'day' | 'night'

interface ThemeStore {
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
}

export const useTheme = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: 'night',
      toggle: () => set((s) => ({ theme: s.theme === 'day' ? 'night' : 'day' })),
      setTheme: (t) => set({ theme: t }),
    }),
    { name: 'starfire-theme' }
  )
)
