'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useApp } from '@/lib/store'
import { lumbreTogetherDays } from '@/lib/madrid-time'

export function Sidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen } = useApp()
  const reduceMotion = useReducedMotion()
  const togetherDays = lumbreTogetherDays()
  const [entering, setEntering] = useState(false)
  const [hugSettled, setHugSettled] = useState(false)
  const [openingMessage, setOpeningMessage] = useState('')
  const enteringRef = useRef(false)

  const open = useCallback((tab: 'chat') => {
    if (enteringRef.current) return
    enteringRef.current = true
    setEntering(true)
    setActiveTab(tab)
    window.setTimeout(() => {
      enteringRef.current = false
      setEntering(false)
      setSidebarOpen(false)
    }, reduceMotion ? 0 : 420)
  }, [reduceMotion, setActiveTab, setSidebarOpen])

  useEffect(() => {
    if (!sidebarOpen) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [sidebarOpen])

  useEffect(() => {
    if (!sidebarOpen) return
    setHugSettled(Boolean(reduceMotion))
    const settleTimer = reduceMotion ? undefined : window.setTimeout(() => setHugSettled(true), 1650)
    const enterTimer = window.setTimeout(() => open('chat'), reduceMotion ? 700 : 3200)
    return () => {
      if (settleTimer) window.clearTimeout(settleTimer)
      window.clearTimeout(enterTimer)
    }
  }, [open, reduceMotion, sidebarOpen])

  useEffect(() => {
    if (!sidebarOpen) return
    let active = true
    fetch('/api/opening-message', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('opening message unavailable')))
      .then(data => { if (active) setOpeningMessage(typeof data.message?.text === 'string' ? data.message.text : '') })
      .catch(() => {})
    return () => { active = false }
  }, [sidebarOpen])

  return (
    <AnimatePresence>
      {sidebarOpen && (
        <motion.aside
          key="lumbre-directory"
          role="dialog"
          aria-modal="true"
          aria-label="Lumbre 开屏"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          className="chat-theme chat-page-shell fixed inset-0 z-[100] grid place-items-center overflow-hidden px-3 py-[max(1rem,env(safe-area-inset-top))]"
        >
          <motion.button
            type="button"
            onClick={() => open('chat')}
            disabled={entering}
            aria-label="进入 Chat"
            aria-current={activeTab === 'chat' ? 'page' : undefined}
            animate={entering ? { opacity: 0 } : { opacity: 1 }}
            whileTap={reduceMotion ? undefined : { scale: 0.99 }}
            transition={{ duration: reduceMotion ? 0 : 0.24 }}
            className="relative flex h-full w-full max-w-xl items-center justify-center focus-visible:outline-none disabled:cursor-wait"
          >
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 8, rotate: -1 }}
              animate={entering ? { opacity: 0, y: -18, scale: 0.96 } : { opacity: 1, y: 0, scale: 1, rotate: -1 }}
              transition={{ duration: reduceMotion ? 0 : 0.36, ease: 'easeOut' }}
              className="chat-session-receipt-wrap relative w-[min(88vw,24rem)]"
            >
              <section className="chat-session-receipt relative flex flex-col items-center px-5 pb-6 pt-8">
                <motion.span
                  aria-hidden="true"
                  animate={reduceMotion ? undefined : { opacity: [0.4, 0.9, 0.4], scale: [0.9, 1.08, 0.9] }}
                  transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                  className="absolute left-7 top-7 text-lg text-[var(--chat-claude-orange)]"
                >
                  ✦
                </motion.span>
                <span aria-hidden="true" className="absolute right-8 top-11 text-xs text-[var(--chat-claude-orange)] opacity-55">✦</span>

                {openingMessage && (
                  <motion.p
                    key={openingMessage}
                    initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="relative z-10 mb-1 w-[88%] whitespace-pre-line text-center text-[clamp(14px,3.7vw,17px)] leading-[1.8] tracking-[0.05em] text-[var(--chat-text)]"
                  >
                    {openingMessage}
                  </motion.p>
                )}

                <motion.div
                  role="img"
                  aria-label="水獭扑进雪豹怀里"
                  initial={reduceMotion ? false : { scale: 0.9, y: 5 }}
                  animate={{ scale: 1, y: 0 }}
                  transition={{ duration: reduceMotion ? 0 : 0.45, ease: 'easeOut' }}
                  className="relative aspect-square w-[min(68vw,17rem)] shrink-0"
                  style={{ filter: 'drop-shadow(0 6px 8px var(--chat-card-shadow))' }}
                >
                  <Image
                    src="/directory/home/otter-jumps-hug.gif"
                    alt=""
                    aria-hidden="true"
                    fill
                    priority
                    unoptimized
                    sizes="(max-width: 640px) 68vw, 272px"
                    className={`pointer-events-none select-none object-contain transition-opacity duration-150 ${hugSettled ? 'opacity-0' : 'opacity-100'}`}
                  />
                  <Image
                    src="/directory/home/otter-hug-final.png"
                    alt=""
                    aria-hidden="true"
                    fill
                    priority
                    unoptimized
                    sizes="(max-width: 640px) 68vw, 272px"
                    className={`pointer-events-none select-none object-contain transition-opacity duration-150 ${hugSettled ? 'opacity-100' : 'opacity-0'}`}
                  />
                </motion.div>

                <p className="chat-session-mono chat-theme-muted relative z-10 text-center text-[11px] tracking-[0.12em]">
                  Leopardo 第{togetherDays}天
                </p>
              </section>
            </motion.div>

            {entering && (
              <span role="status" aria-live="polite" className="sr-only">正在进入 Chat</span>
            )}
          </motion.button>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
