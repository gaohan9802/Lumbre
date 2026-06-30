'use client'

import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { Menu } from 'lucide-react'

export function TopBar() {
  const { toggleSidebar, activeTab, currentUser } = useApp()
  const { theme } = useTheme()

  const titles: Record<string, string> = {
    chat: '💬 Chat',
    diary: '📔 Diary',
    notes: '📌 Notes',
    todo: '🧾 Today\'s Receipt',
    calendar: '📅 Calendar',
    memory: '🧠 Memory Palace',
  }

  return (
    <header className={`
      sticky top-0 z-30 px-4 py-3
      flex items-center justify-between
      ${theme === 'night' 
        ? 'bg-night-bg/80 border-night-border' 
        : 'bg-day-bg/80 border-day-muted/10'
      }
      border-b backdrop-blur-md
      md:hidden
    `}>
      <button onClick={toggleSidebar} className="p-1">
        <Menu size={20} />
      </button>
      <span className="text-sm font-medium">{titles[activeTab]}</span>
      <span className="text-base">{currentUser === 'fire' ? '🔥' : '⭐'}</span>
    </header>
  )
}
