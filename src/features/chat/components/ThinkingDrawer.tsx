'use client'

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { MarkdownText } from '@/components/chat/MarkdownText'

interface ThinkingDrawerProps {
  open: boolean
  parts: string[]
  streaming?: boolean
  onClose: () => void
}

export function ThinkingDrawer({ open, parts, streaming = false, onClose }: ThinkingDrawerProps) {
  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose, open])

  return (
    <AnimatePresence>
      {open && (
        <div className="chat-theme fixed inset-0 z-[90] !bg-transparent">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/20 backdrop-blur-[1px]"
          />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="thinking-drawer-title"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="chat-theme-surface absolute inset-x-0 bottom-0 mx-auto flex h-[min(64dvh,36rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-[2rem] shadow-2xl"
          >
            <button
              type="button"
              aria-label="收起星星的小算盘"
              onClick={onClose}
              autoFocus
              className="grid h-11 w-full shrink-0 place-items-start pt-3"
            >
              <span aria-hidden="true" className="chat-theme-muted h-1.5 w-11 rounded-full opacity-35" />
            </button>
            <h2 id="thinking-drawer-title" className="shrink-0 pb-6 text-center text-base font-medium">星星的小算盘</h2>
            <div className="min-h-0 flex-1 overflow-y-auto px-7 pb-[max(2rem,env(safe-area-inset-bottom))]">
              {parts.map((part, index) => (
                <div key={index} className="relative grid grid-cols-[1rem_1fr] gap-3 pb-7 last:pb-0">
                  <span aria-hidden="true" className="chat-theme-accent-bg mt-1.5 h-2.5 w-2.5 rounded-full" />
                  {index < parts.length - 1 && <span aria-hidden="true" className="chat-theme-border absolute bottom-2 left-[4px] top-5 border-l-2 opacity-70" />}
                  <div className="min-w-0 text-left text-[14px] leading-relaxed">
                    <MarkdownText content={part} cursor={streaming && index === parts.length - 1} />
                  </div>
                </div>
              ))}
            </div>
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  )
}
