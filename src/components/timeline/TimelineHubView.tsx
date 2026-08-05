'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTheme } from '@/lib/theme'
import { TimelineView } from './TimelineView'
import { TesisView } from '@/components/tesis/TesisView'

export function TimelineHubView() {
  const [page, setPage] = useState<'timeline' | 'tesis'>('timeline')
  const { theme } = useTheme()
  const night = theme === 'night'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className={`flex justify-center border-b px-4 py-2 ${night ? 'border-night-border bg-night-bg' : 'border-day-border bg-day-bg'}`}>
        <div className={`flex rounded-full p-1 ${night ? 'bg-night-card' : 'bg-white/75 shadow-sm'}`}>
          {(['timeline', 'tesis'] as const).map((id) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={`relative min-w-[92px] rounded-full px-4 py-2 text-xs transition-colors ${
                page === id ? (night ? 'text-night-text' : 'text-day-text') : (night ? 'text-night-muted' : 'text-day-muted')
              }`}
            >
              {page === id && (
                <motion.span
                  layoutId="timeline-subpage"
                  className={`absolute inset-0 rounded-full ${night ? 'bg-night-surface' : 'bg-[#E8E5DD]'}`}
                  transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                />
              )}
              <span className="relative">{id === 'timeline' ? 'Timeline' : 'Tesis'}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={page}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.14 }}
            className="h-full"
          >
            {page === 'timeline' ? <TimelineView /> : <TesisView />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
