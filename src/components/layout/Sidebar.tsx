'use client'

import { useEffect, useMemo } from 'react'
import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence, Variants, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'

const tabs = [
  { id: 'chat' as const, label: '星星', image: '/directory/chat.jpg' },
  { id: 'timeline' as const, label: 'Timeline', image: '/directory/timeline.jpg' },
  { id: 'diary' as const, label: '日记', image: '/directory/diary.jpg' },
  { id: 'notes' as const, label: '小纸条', image: '/directory/notes.jpg' },
  { id: 'todo' as const, label: '代办', image: '/directory/todo.jpg' },
  { id: 'photos' as const, label: '照片', image: '/directory/foto.jpg' },
  { id: 'memory' as const, label: '记忆', image: '/directory/memory.jpg' },
  { id: 'dreams' as const, label: '现实与梦境', image: '/directory/dream.jpg' },
]

const listVariants: Variants = {
  hidden: {},
  visible: { transition: { delayChildren: 0.05, staggerChildren: 0.055 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14, scale: 0.985 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 300, damping: 28 },
  },
}

export function Sidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen } = useApp()
  const { theme, toggle } = useTheme()
  const isNight = theme === 'night'
  const reduceMotion = useReducedMotion()
  const togetherDays = useMemo(() => {
    const now = new Date()
    // Use the date-difference convention requested: 4/27 → 8/6 = 101 days.
    let start = new Date(now.getFullYear(), 3, 27)
    if (now < start) start = new Date(now.getFullYear() - 1, 3, 27)
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    return Math.floor((today.getTime() - startDay.getTime()) / 86400000)
  }, [sidebarOpen])

  useEffect(() => {
    if (!sidebarOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [sidebarOpen, setSidebarOpen])

  return (
    <AnimatePresence>
      {sidebarOpen && (
        <motion.aside
          key="lumbre-directory"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18 }}
          aria-label="Lumbre 目录"
          className="fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-[#E8E5DD] text-[#4d4740]"
        >
          <div
            className="mx-auto flex min-h-full w-full max-w-[560px] flex-col px-6 sm:px-10"
            style={{
              paddingTop: 'max(0.8rem, env(safe-area-inset-top))',
              paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            }}
          >
            <header className="flex items-center justify-between pb-2 pt-1">
              <p className="pl-1 text-[11px] tracking-[0.18em] text-[#756d64]">在一起 {togetherDays} 天</p>
              <motion.button
                whileTap={{ scale: 0.88, rotate: -5 }}
                onClick={() => setSidebarOpen(false)}
                aria-label="关闭目录"
                className="grid h-9 w-9 place-items-center rounded-full bg-white/55 text-[#615a52] shadow-[0_4px_18px_rgba(73,66,58,0.08)] backdrop-blur-sm"
              >
                <X size={18} strokeWidth={1.7} />
              </motion.button>
            </header>

            <motion.nav
              variants={listVariants}
              initial={reduceMotion ? false : 'hidden'}
              animate="visible"
              className="flex flex-1 flex-col justify-center gap-2 py-2 sm:gap-2.5 sm:py-3"
            >
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id
                return (
                  <motion.button
                    variants={itemVariants}
                    key={tab.id}
                    whileHover={reduceMotion ? undefined : { y: -2, scale: 1.006 }}
                    whileTap={{ scale: 0.975, y: 1 }}
                    onClick={() => {
                      setActiveTab(tab.id)
                      window.setTimeout(() => setSidebarOpen(false), 90)
                    }}
                    aria-label={tab.label}
                    aria-current={isActive ? 'page' : undefined}
                    className={`relative block mx-auto w-[78%] overflow-hidden rounded-[13px] bg-white/25 text-left shadow-[0_5px_20px_rgba(72,64,55,0.07)] transition-shadow sm:w-[72%] sm:rounded-[15px] ${
                      isActive ? 'ring-2 ring-white/90 shadow-[0_7px_24px_rgba(72,64,55,0.12)]' : ''
                    }`}
                  >
                    <img
                      src={tab.image}
                      alt=""
                      draggable={false}
                      className="block aspect-[1036/275] w-full object-cover"
                    />
                    {isActive && <span className="absolute right-3 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_3px_rgba(255,255,255,0.35)]" />}
                  </motion.button>
                )
              })}
            </motion.nav>

            <footer className="flex justify-center pb-0 pt-2">
              <motion.button
                whileTap={{ scale: 0.88, rotate: -8 }}
                onClick={toggle}
                aria-label={isNight ? '切换到日间模式' : '切换到夜间模式'}
                className="grid h-10 w-10 place-items-center rounded-full bg-white/55 text-lg shadow-[0_5px_20px_rgba(72,64,55,0.09)] backdrop-blur-sm"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={theme}
                    initial={{ opacity: 0, y: 5, rotate: -15 }}
                    animate={{ opacity: 1, y: 0, rotate: 0 }}
                    exit={{ opacity: 0, y: -5, rotate: 15 }}
                    transition={{ duration: 0.14 }}
                  >
                    {isNight ? '☀️' : '🌙'}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
            </footer>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
