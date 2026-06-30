'use client'

import { useEffect } from 'react'
import { useTheme } from '@/lib/theme'

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme()

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'night') {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }, [theme])

  return (
    <div className={`min-h-screen transition-colors duration-500 ${
      theme === 'night' ? 'bg-night-bg text-night-text' : 'bg-day-bg text-day-text'
    }`}>
      {children}
    </div>
  )
}
