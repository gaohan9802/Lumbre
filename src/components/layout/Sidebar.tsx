'use client'

import { useEffect } from 'react'
import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence, Variants, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'

const tabs = [
  { id: 'chat' as const, label: '星星', emoji: '🐆', hint: '去找星星说说话' },
  { id: 'timeline' as const, label: 'Timeline', emoji: '⏱️', hint: '今天如何流过' },
  { id: 'diary' as const, label: '日记', emoji: '📔', hint: '收藏今天' },
  { id: 'notes' as const, label: '小纸条', emoji: '📌', hint: '留一句话' },
  { id: 'todo' as const, label: '待办', emoji: '🧾', hint: '慢慢完成' },
  { id: 'photos' as const, label: '照片', emoji: '📷', hint: '留住瞬间' },
  { id: 'memory' as const, label: '记忆', emoji: '✨', hint: '闪光碎片' },
  { id: 'tesis' as const, label: 'Tesis', emoji: '📄', hint: '认真生长' },
  { id: 'dreams' as const, label: '现实与梦境', emoji: '🌙', hint: '两边漫游' },
  { id: 'wishlist' as const, label: '愿望清单', emoji: '🌠', hint: '等愿望发芽' },
]

const listVariants: Variants = {
  hidden: {},
  visible: { transition: { delayChildren: 0.08, staggerChildren: 0.045 } },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 13, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: 'spring', stiffness: 330, damping: 27 },
  },
}

export function Sidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen } = useApp()
  const { theme, toggle } = useTheme()
  const isNight = theme === 'night'
  const reduceMotion = useReducedMotion()

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
          initial={{ opacity: 0, scale: 1.015 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.01 }}
          transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
          aria-label="Lumbre 目录"
          className={`fixed inset-0 z-[100] overflow-y-auto overscroll-contain ${
            isNight ? 'bg-night-bg text-night-text' : 'bg-day-bg text-day-text'
          }`}
        >
          <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
            <motion.span
              animate={reduceMotion ? undefined : { x: [0, 14, 0], y: [0, -10, 0], scale: [1, 1.08, 1] }}
              transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
              className={`absolute -right-20 -top-20 h-72 w-72 rounded-full blur-3xl ${isNight ? 'bg-night-amber/10' : 'bg-day-honey/30'}`}
            />
            <motion.span
              animate={reduceMotion ? undefined : { x: [0, -12, 0], y: [0, 12, 0], scale: [1, 1.1, 1] }}
              transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
              className={`absolute -bottom-28 -left-24 h-80 w-80 rounded-full blur-3xl ${isNight ? 'bg-night-info/10' : 'bg-day-sky/20'}`}
            />
            <span className="absolute left-[8%] top-[18%] text-xs opacity-30">✦</span>
            <span className="absolute right-[12%] top-[42%] text-[9px] opacity-25">✧</span>
            <span className="absolute bottom-[16%] right-[22%] text-xs opacity-20">✦</span>
          </div>

          <div
            className="relative mx-auto flex min-h-full w-full max-w-5xl flex-col px-5 sm:px-8"
            style={{
              paddingTop: 'max(1rem, env(safe-area-inset-top))',
              paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            }}
          >
            <header className="flex items-center justify-between py-2 sm:py-4">
              <div className="flex items-center gap-3">
                <motion.img
                  src="/icon-192.png"
                  alt=""
                  initial={{ rotate: -5, scale: 0.9 }}
                  animate={{ rotate: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.04 }}
                  className={`h-12 w-12 rounded-[1.05rem] shadow-lg sm:h-14 sm:w-14 ${isNight ? 'shadow-black/25' : 'shadow-day-honey/30'}`}
                />
                <div>
                  <h1 className="text-base font-semibold tracking-[0.12em] sm:text-lg">LUMBRE</h1>
                  <p className={`mt-0.5 text-[10px] tracking-[0.16em] ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>星星和小火的家</p>
                </div>
              </div>
              <motion.button
                whileHover={{ rotate: 5, scale: 1.05 }}
                whileTap={{ scale: 0.88, rotate: -6 }}
                onClick={() => setSidebarOpen(false)}
                aria-label="关闭目录"
                className={`grid h-11 w-11 place-items-center rounded-full border transition-colors ${
                  isNight
                    ? 'border-night-border bg-night-card text-night-muted hover:text-night-text'
                    : 'border-day-border bg-white text-day-muted shadow-sm hover:text-day-text'
                }`}
              >
                <X size={19} />
              </motion.button>
            </header>

            <div className="mb-4 mt-4 flex items-end justify-between sm:mb-6 sm:mt-7">
              <div>
                <p className={`text-[10px] uppercase tracking-[0.34em] ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>Directory</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-wide sm:text-3xl">今天想去哪里？</h2>
              </div>
              <span className={`hidden text-xs sm:block ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>轻轻点一下就到啦</span>
            </div>

            <motion.nav
              variants={listVariants}
              initial={reduceMotion ? false : "hidden"}
              animate="visible"
              className="grid flex-1 auto-rows-fr grid-cols-2 gap-3 pb-5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5"
            >
              {tabs.map((tab, index) => {
                const isActive = activeTab === tab.id
                return (
                  <motion.button
                    variants={itemVariants}
                    key={tab.id}
                    whileHover={{ y: -3, rotate: index % 2 === 0 ? -0.5 : 0.5 }}
                    whileTap={{ scale: 0.94, y: 1 }}
                    onClick={() => {
                      setActiveTab(tab.id)
                      window.setTimeout(() => setSidebarOpen(false), 75)
                    }}
                    aria-current={isActive ? 'page' : undefined}
                    className={`group relative flex min-h-[112px] flex-col items-start justify-between overflow-hidden rounded-[1.55rem] border p-4 text-left transition-colors sm:min-h-[138px] sm:p-5 ${
                      isActive
                        ? isNight
                          ? 'border-night-amber/45 bg-night-amber/10 text-night-amberGlow shadow-[0_12px_30px_rgba(0,0,0,0.18)]'
                          : 'border-day-pink/25 bg-white text-day-pinkDeep shadow-[0_12px_30px_rgba(239,64,103,0.10)]'
                        : isNight
                          ? 'border-night-border bg-night-card/80 hover:border-night-amber/25 hover:bg-night-card'
                          : 'border-day-border bg-white hover:border-day-honey hover:bg-white'
                    }`}
                  >
                    <span className={`absolute right-3 top-2 text-[9px] transition-opacity ${isActive ? 'opacity-70' : 'opacity-0 group-hover:opacity-40'}`}>✦</span>
                    <motion.span
                      whileHover={{ rotate: [-3, 4, 0], scale: 1.08 }}
                      className={`grid h-10 w-10 place-items-center rounded-2xl text-xl sm:h-12 sm:w-12 sm:text-2xl ${
                        isNight ? 'bg-night-surface' : isActive ? 'bg-day-pinkLight' : 'bg-day-tint'
                      }`}
                    >
                      {tab.emoji}
                    </motion.span>
                    <span className="mt-3 min-w-0">
                      <span className="block truncate text-sm font-semibold sm:text-base">{tab.label}</span>
                      <span className={`mt-0.5 block truncate text-[9px] sm:text-[10px] ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>{tab.hint}</span>
                    </span>
                    {isActive && <span className={`absolute bottom-3 right-3 h-1.5 w-1.5 rounded-full ${isNight ? 'bg-night-amberGlow shadow-[0_0_8px_#f5c96b]' : 'bg-day-pink shadow-[0_0_8px_#ef4067]'}`} />}
                  </motion.button>
                )
              })}
            </motion.nav>

            <motion.footer
              variants={itemVariants}
              initial={reduceMotion ? false : "hidden"}
              animate="visible"
              transition={{ delay: 0.52 }}
              className="flex items-center justify-center border-t py-3 sm:py-4"
              style={{ borderColor: isNight ? '#2e3d4d' : '#F0E4DD' }}
            >
              <motion.button
                whileHover={{ rotate: 8, scale: 1.06 }}
                whileTap={{ scale: 0.87, rotate: -8 }}
                onClick={toggle}
                aria-label={isNight ? '切换到日间模式' : '切换到夜间模式'}
                title={isNight ? '切换到日间模式' : '切换到夜间模式'}
                className={`grid h-11 w-11 place-items-center rounded-full border text-lg shadow-sm transition-colors ${
                  isNight
                    ? 'border-night-border bg-night-card hover:border-night-amber/40'
                    : 'border-day-border bg-white hover:border-day-pink/25'
                }`}
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={theme}
                    initial={{ opacity: 0, y: 7, rotate: -20 }}
                    animate={{ opacity: 1, y: 0, rotate: 0 }}
                    exit={{ opacity: 0, y: -7, rotate: 20 }}
                    transition={{ duration: 0.16 }}
                  >
                    {isNight ? '☀️' : '🌙'}
                  </motion.span>
                </AnimatePresence>
              </motion.button>
            </motion.footer>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
