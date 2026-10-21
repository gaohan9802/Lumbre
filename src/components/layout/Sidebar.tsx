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
  const [openingMessage, setOpeningMessage] = useState('')

  useEffect(() => {
    if (!sidebarOpen) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [sidebarOpen])

  useEffect(() => {
    if (!sidebarOpen) return
    let active = true
    fetch('/api/opening-message', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('opening message unavailable')))
      .then(data => { if (active) setOpeningMessage(typeof data.message?.text === 'string' ? data.message.text : '') })
      .catch(() => {})
    return () => { active = false }
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
          style={{ backgroundImage: 'url("/directory/home/leopardo-paper.webp")', backgroundRepeat: 'repeat', backgroundSize: '512px 512px' }}
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
            className="relative h-[min(78dvh,52rem)] w-full max-w-5xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7F6958]/45 disabled:cursor-wait"
          >
            {openingMessage && (
              <div className="absolute inset-x-0 top-[7%] flex justify-center">
                <motion.p
                  key={openingMessage}
                  initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-[82%] whitespace-pre-line text-center font-serif text-[clamp(15px,3.8vw,25px)] leading-[1.9] tracking-[0.08em] text-[#554A43]/85"
                >
                  {openingMessage}
                </motion.p>
              </div>
            )}

            <span className="absolute inset-x-[2%] bottom-[16%] top-[31%]">
              <Image
                src="/directory/home/leopardo-stamp-transparent.webp"
                alt="雪豹与山城手压图章"
                fill
                priority
                unoptimized
                sizes="(max-width: 896px) 96vw, 960px"
                className="pointer-events-none select-none object-contain"
              />
            </span>

            <p className="absolute bottom-[13.5%] left-1/2 w-[80%] -translate-x-1/2 text-center font-receipt text-[clamp(10px,2.5vw,18px)] tracking-[0.12em] text-[#554A43]/80">
              Leopardo 第{togetherDays}天
            </p>

            {entering && (
              <span role="status" aria-live="polite" className="absolute bottom-[2.5%] left-1/2 flex w-[80%] -translate-x-1/2 items-center justify-center gap-1 text-[#554A43]/55">
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
