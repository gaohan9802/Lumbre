'use client'

import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageCircle,
  BookOpen,
  StickyNote,
  ClipboardList,
  Calendar,
  Brain,
  Sun,
  Moon,
  X,
  Heart,
} from 'lucide-react'

const tabs = [
  { id: 'chat' as const, label: '对话', icon: MessageCircle, emoji: '💬' },
  { id: 'diary' as const, label: '日记', icon: BookOpen, emoji: '📔' },
  { id: 'notes' as const, label: '留言', icon: StickyNote, emoji: '📌' },
  { id: 'todo' as const, label: '待办', icon: ClipboardList, emoji: '🧾' },
  { id: 'calendar' as const, label: '日历', icon: Calendar, emoji: '📅' },
  { id: 'memory' as const, label: '记忆', icon: Brain, emoji: '🧠' },
]

export function Sidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen, currentUser, setCurrentUser } = useApp()
  const { theme, toggle } = useTheme()

  return (
    <>
      {/* Mobile overlay */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside className={`
        fixed md:static inset-y-0 left-0 z-50
        w-64 md:w-20 lg:w-64
        flex flex-col
        transition-all duration-300 ease-out
        ${theme === 'night' ? 'bg-night-card border-night-border' : 'bg-white/80 border-day-muted/20'}
        border-r
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Header */}
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏠</span>
            <span className="font-medium text-sm md:hidden lg:block">Lumbre</span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden p-1">
            <X size={18} />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-4 space-y-1">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActiveTab(tab.id)
                  setSidebarOpen(false)
                }}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-xl
                  text-sm transition-all duration-200
                  md:justify-center lg:justify-start
                  ${isActive
                    ? theme === 'night'
                      ? 'bg-night-amber/15 text-night-amber'
                      : 'bg-day-pink/15 text-day-heart'
                    : theme === 'night'
                      ? 'text-night-muted hover:text-night-text hover:bg-night-surface'
                      : 'text-day-muted hover:text-day-text hover:bg-day-pink/5'
                  }
                `}
              >
                <span className="text-base">{tab.emoji}</span>
                <span className="md:hidden lg:inline">{tab.label}</span>
                {isActive && (
                  <motion.div
                    layoutId="activeTab"
                    className={`absolute left-0 w-1 h-6 rounded-r-full ${
                      theme === 'night' ? 'bg-night-amber' : 'bg-day-pink'
                    }`}
                  />
                )}
              </button>
            )
          })}
        </nav>

        {/* Bottom controls */}
        <div className="p-3 space-y-2 border-t border-inherit">
          {/* Theme toggle */}
          <button
            onClick={toggle}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm
              md:justify-center lg:justify-start
              transition-colors
              ${theme === 'night'
                ? 'text-night-amber hover:bg-night-surface'
                : 'text-day-honey hover:bg-day-lemon/30'
              }
            `}
          >
            {theme === 'night' ? <Moon size={18} /> : <Sun size={18} />}
            <span className="md:hidden lg:inline">
              {theme === 'night' ? 'Night' : 'Day'}
            </span>
          </button>

          {/* User switch */}
          <button
            onClick={() => setCurrentUser(currentUser === 'fire' ? 'star' : 'fire')}
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm
              md:justify-center lg:justify-start
              transition-colors
              ${theme === 'night'
                ? 'text-night-muted hover:bg-night-surface'
                : 'text-day-muted hover:bg-day-pink/5'
              }
            `}
          >
            <span className="text-base">{currentUser === 'fire' ? '🔥' : '⭐'}</span>
            <span className="md:hidden lg:inline">
              {currentUser === 'fire' ? 'Non' : 'Star'}
            </span>
          </button>
        </div>
      </aside>
    </>
  )
}
