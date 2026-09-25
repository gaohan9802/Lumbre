'use client'

import Image from 'next/image'
import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { useApp } from '@/lib/store'
import { lumbreTogetherDays } from '@/lib/madrid-time'

export function Sidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen } = useApp()
  const reduceMotion = useReducedMotion()
  const togetherDays = lumbreTogetherDays()

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

  const open = (tab: 'chat') => {
    setActiveTab(tab)
    window.setTimeout(() => setSidebarOpen(false), reduceMotion ? 0 : 100)
  }

  return (
    <AnimatePresence>
      {sidebarOpen && (
        <motion.aside
          key="lumbre-directory"
          role="dialog"
          aria-modal="true"
          aria-label="Lumbre 目录"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-[#F7F5F1]"
        >
          <div
            className="relative aspect-[426/923] max-h-dvh overflow-hidden"
            style={{ width: 'min(100vw, calc(100dvh * 426 / 923), 520px)' }}
          >
            <Image
              src="/directory/home/composition.png?v=2598345"
              alt=""
              fill
              priority
              unoptimized
              sizes="(max-width: 520px) 100vw, 520px"
              className="pointer-events-none select-none object-contain"
            />

            <motion.button
              type="button"
              onClick={() => open('chat')}
              aria-label="星星"
              aria-current={activeTab === 'chat' ? 'page' : undefined}
              whileTap={{ scale: 0.98 }}
              className="absolute left-[19%] top-[35%] z-10 h-[31%] w-[58%] rounded-[42%] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B78337]/55"
            />

            <p className="absolute inset-x-0 top-[89%] text-center font-serif text-[11px] tracking-[0.24em] text-[#9f302b]/70">
              <span className="mr-2 text-[#d99118]">·</span>在一起 · 第 {togetherDays} 天<span className="ml-2 text-[#718b97]">·</span>
            </p>

            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              aria-label="关闭目录"
              className="absolute right-2 top-2 z-20 grid h-11 w-11 place-items-center rounded-full text-[#6F5143]/55 transition-colors hover:text-[#51382D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B78337]/45"
              style={{ marginTop: 'env(safe-area-inset-top)' }}
            >
              <X size={17} strokeWidth={1.35} />
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
