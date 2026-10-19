'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useApp } from '@/lib/store'
import { lumbreTogetherDays } from '@/lib/madrid-time'

export function Sidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen } = useApp()
  const reduceMotion = useReducedMotion()
  const togetherDays = lumbreTogetherDays()
  const [entering, setEntering] = useState(false)

  useEffect(() => {
    if (!sidebarOpen) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [sidebarOpen])

  const open = (tab: 'chat') => {
    if (entering) return
    setEntering(true)
    window.setTimeout(() => {
      setEntering(false)
      setSidebarOpen(false)
    }, reduceMotion ? 0 : 420)
    setActiveTab(tab)
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
          className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-[#F4EFE6] px-3 py-[max(1rem,env(safe-area-inset-top))]"
        >
          <motion.button
            type="button"
            onClick={() => open('chat')}
            disabled={entering}
            aria-label="进入 Chat"
            aria-current={activeTab === 'chat' ? 'page' : undefined}
            animate={entering ? { scale: 0.985, opacity: 0.82 } : { scale: 1, opacity: 1 }}
            whileTap={reduceMotion ? undefined : { scale: 0.99 }}
            transition={{ duration: reduceMotion ? 0 : 0.24 }}
            className="relative aspect-[4/3] w-full max-w-4xl overflow-hidden shadow-[0_18px_55px_rgba(75,55,38,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7F6958]/45 disabled:cursor-wait"
          >
            <Image
              src="/directory/home/leopardo-archive.webp"
              alt="雪豹玩偶俯瞰暮色中的城市，旁边是同一画面的手压图章"
              fill
              priority
              unoptimized
              sizes="(max-width: 896px) 100vw, 896px"
              className="pointer-events-none select-none object-cover"
            />

            <p className="absolute bottom-[7.5%] left-[59%] w-[38%] text-center font-receipt text-[clamp(10px,2.5vw,18px)] tracking-[0.12em] text-[#554A43]/80">
              Leopardo 第{togetherDays}天
            </p>

            {entering && (
              <span role="status" aria-live="polite" className="absolute bottom-[2.5%] left-[59%] flex w-[38%] items-center justify-center gap-1 text-[#554A43]/55">
                <span className="h-1 w-1 animate-bounce rounded-full bg-current" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:110ms]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-current [animation-delay:220ms]" />
                <span className="sr-only">正在进入 Chat</span>
              </span>
            )}
          </motion.button>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
