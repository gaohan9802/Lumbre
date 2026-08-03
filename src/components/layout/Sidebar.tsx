'use client'

import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

const tabs = [
  { id: 'chat' as const, label: '星星', emoji: '🐆', hint: '说说话' },
  { id: 'timeline' as const, label: 'Timeline', emoji: '⏱️', hint: '今天如何流过' },
  { id: 'diary' as const, label: '日记', emoji: '📔', hint: '收藏今天' },
  { id: 'notes' as const, label: '小纸条', emoji: '📌', hint: '留一句话' },
  { id: 'todo' as const, label: '待办', emoji: '🧾', hint: '慢慢完成' },
  { id: 'photos' as const, label: '照片', emoji: '📷', hint: '留住瞬间' },
  { id: 'memory' as const, label: '记忆', emoji: '✨', hint: '闪光碎片' },
  { id: 'coreading' as const, label: '阅读', emoji: '📖', hint: '一起翻页' },
  { id: 'tesis' as const, label: 'Tesis', emoji: '📄', hint: '认真生长' },
  { id: 'dreams' as const, label: '现实与梦境', emoji: '🌙', hint: '两边漫游' },
  { id: 'wishlist' as const, label: '愿望清单', emoji: '🌠', hint: '等愿望发芽' },
]

export function Sidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen } = useApp()
  const { theme, toggle } = useTheme()
  const isNight = theme === 'night'

  return (
    <>
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-40 bg-[#241a20]/35 backdrop-blur-[3px] md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
      </AnimatePresence>

      <aside
        className={`
          sidebar-shell fixed inset-y-0 left-0 z-50 flex w-[17.5rem] flex-col overflow-hidden
          border-r transition-[transform,width] duration-300 ease-out md:static md:w-[5.5rem] lg:w-[17rem]
          ${isNight
            ? 'border-night-border/80 bg-night-card text-night-text shadow-[12px_0_40px_rgba(0,0,0,0.18)]'
            : 'border-day-border/80 bg-day-tint text-day-text shadow-[12px_0_40px_rgba(111,73,65,0.08)]'
          }
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* Quiet ambient shapes make the sidebar feel alive without stealing focus. */}
        <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
          <span className={`sidebar-breathe absolute -right-16 -top-16 h-44 w-44 rounded-full blur-2xl ${isNight ? 'bg-night-amber/10' : 'bg-day-honey/25'}`} />
          <span className={`sidebar-breathe-delayed absolute -bottom-20 -left-20 h-48 w-48 rounded-full blur-3xl ${isNight ? 'bg-night-info/10' : 'bg-day-sky/15'}`} />
          <span className={`absolute left-7 top-28 text-[8px] opacity-50 md:left-4 lg:left-7 ${isNight ? 'text-night-amberGlow' : 'text-day-honey'}`}>✦</span>
          <span className={`absolute right-6 top-[38%] text-[7px] opacity-40 md:hidden lg:block ${isNight ? 'text-night-amber' : 'text-day-sky'}`}>✧</span>
        </div>

        <header className="relative px-3 pb-3 pt-4 lg:px-4">
          <div className={`flex min-h-[4.25rem] items-center rounded-[1.4rem] border px-3 md:justify-center md:px-2 lg:justify-start lg:px-3 ${isNight ? 'border-night-border/80 bg-night-bg/40' : 'border-white/80 bg-white/60 shadow-[0_8px_24px_rgba(111,73,65,0.06)]'}`}>
            <motion.div
              animate={{ y: [0, -2, 0], rotate: [0, -2, 0] }}
              transition={{ duration: 4.8, repeat: Infinity, ease: 'easeInOut' }}
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-xl ${isNight ? 'bg-night-amber/15 shadow-[0_0_20px_rgba(226,168,75,0.08)]' : 'bg-day-pinkLight shadow-[0_6px_16px_rgba(239,64,103,0.10)]'}`}
            >
              🔥
            </motion.div>
            <div className="ml-3 min-w-0 md:hidden lg:block">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold tracking-[0.08em]">Lumbre</span>
                <span className={`text-[8px] ${isNight ? 'text-night-amberGlow' : 'text-day-pink'}`}>●</span>
              </div>
              <p className={`mt-0.5 whitespace-nowrap text-[10px] tracking-wide ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>星星和小火的家</p>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              aria-label="关闭菜单"
              className={`ml-auto rounded-full p-2 transition-colors md:hidden ${isNight ? 'text-night-muted hover:bg-night-surface hover:text-night-text' : 'text-day-muted hover:bg-day-pinkLight hover:text-day-text'}`}
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="relative flex items-center gap-2 px-6 pb-2 pt-1 md:justify-center md:px-2 lg:justify-start lg:px-6">
          <span className={`text-[9px] font-medium uppercase tracking-[0.22em] md:hidden lg:inline ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>小宇宙漫游</span>
          <span className={`h-px flex-1 md:hidden lg:block ${isNight ? 'bg-night-border/70' : 'bg-day-border'}`} />
          <span className={`hidden text-[9px] md:inline lg:hidden ${isNight ? 'text-night-amber/70' : 'text-day-pink/60'}`}>✦</span>
        </div>

        <nav className="relative flex-1 space-y-1 overflow-y-auto px-3 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:px-4">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id
            return (
              <motion.button
                key={tab.id}
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => {
                  setActiveTab(tab.id)
                  setSidebarOpen(false)
                }}
                aria-current={isActive ? 'page' : undefined}
                title={`${tab.label} · ${tab.hint}`}
                className={`
                  group relative flex w-full items-center gap-3 overflow-hidden rounded-[1.15rem]
                  px-2.5 py-2 text-left transition-colors duration-200 md:justify-center lg:justify-start
                  ${isActive
                    ? isNight ? 'text-night-amberGlow' : 'text-day-pinkDeep'
                    : isNight
                      ? 'text-night-muted hover:bg-night-surface/60 hover:text-night-text'
                      : 'text-day-muted hover:bg-white/65 hover:text-day-text'
                  }
                `}
              >
                {isActive && (
                  <motion.span
                    layoutId="sidebar-active-pill"
                    transition={{ type: 'spring', stiffness: 360, damping: 32 }}
                    className={`absolute inset-0 rounded-[1.15rem] border ${isNight ? 'border-night-amber/20 bg-night-amber/10 shadow-[inset_0_0_20px_rgba(226,168,75,0.035)]' : 'border-day-pink/10 bg-white/85 shadow-[0_6px_18px_rgba(239,64,103,0.08)]'}`}
                  />
                )}

                <span
                  className={`relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-[0.9rem] text-[17px] transition-all duration-200 group-hover:-rotate-3 group-hover:scale-105 ${
                    isActive
                      ? isNight
                        ? 'bg-night-amber/[0.18] shadow-[0_0_18px_rgba(226,168,75,0.10)]'
                        : 'bg-day-pinkLight shadow-[0_5px_12px_rgba(239,64,103,0.12)]'
                      : isNight ? 'bg-night-bg/35' : 'bg-white/45'
                  }`}
                >
                  {tab.emoji}
                </span>

                <span className="relative z-10 min-w-0 flex-1 md:hidden lg:block">
                  <span className={`block truncate text-[13px] ${isActive ? 'font-semibold' : 'font-medium'}`}>{tab.label}</span>
                  <span className={`block truncate text-[9px] leading-3.5 ${isNight ? 'text-night-muted' : 'text-day-muted'} ${isActive ? 'opacity-90' : 'opacity-65'}`}>{tab.hint}</span>
                </span>

                {isActive && (
                  <motion.span
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className={`relative z-10 mr-1 h-1.5 w-1.5 shrink-0 rounded-full md:absolute md:right-1 lg:static ${isNight ? 'bg-night-amberGlow shadow-[0_0_8px_rgba(245,201,107,0.7)]' : 'bg-day-pink shadow-[0_0_8px_rgba(239,64,103,0.35)]'}`}
                  />
                )}
              </motion.button>
            )
          })}
        </nav>

        <footer className="relative p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:p-4 lg:pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            onClick={toggle}
            aria-label={isNight ? '切换到日间模式' : '切换到夜间模式'}
            title={isNight ? '切换到日间模式' : '切换到夜间模式'}
            className={`group flex w-full items-center rounded-[1.2rem] border p-2 transition-all duration-200 md:justify-center lg:justify-start ${isNight ? 'border-night-border bg-night-bg/45 text-night-amber hover:border-night-amber/30' : 'border-white/80 bg-white/60 text-day-pink shadow-[0_6px_20px_rgba(111,73,65,0.05)] hover:border-day-pink/15'}`}
          >
            <span className={`relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-xl ${isNight ? 'bg-night-surface' : 'bg-day-pinkLight'}`}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={theme}
                  initial={{ y: 12, opacity: 0, rotate: -20 }}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  exit={{ y: -12, opacity: 0, rotate: 20 }}
                  transition={{ duration: 0.2 }}
                  className="absolute text-base"
                >
                  {isNight ? '🌙' : '🌸'}
                </motion.span>
              </AnimatePresence>
            </span>
            <span className="ml-3 min-w-0 md:hidden lg:block">
              <span className="block text-xs font-medium">{isNight ? '雪豹夜行' : '白日做梦'}</span>
              <span className={`block text-[9px] ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>轻轻点一下换天空</span>
            </span>
            <span className="ml-auto mr-1 hidden text-[10px] opacity-50 lg:block">↗</span>
          </button>
        </footer>
      </aside>
    </>
  )
}
