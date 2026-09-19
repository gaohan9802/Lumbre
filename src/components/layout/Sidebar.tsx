'use client'

import Image from 'next/image'
import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { X } from 'lucide-react'
import { useApp } from '@/lib/store'

const entrances = [
  { id: 'research', label: '星野手记', left: '47%', top: '13%', width: '24%', height: '14%' },
  { id: 'poems', label: '共诗', left: '18%', top: '22%', width: '32%', height: '12%' },
  { id: 'timeline', label: 'Timeline', left: '70%', top: '25%', width: '20%', height: '12%' },
  { id: 'stories', label: '枕边集', left: '3%', top: '30%', width: '25%', height: '12%' },
  { id: 'diary', label: '日记', left: '78%', top: '37%', width: '22%', height: '13%' },
  { id: 'photos', label: '照片', left: '2%', top: '59%', width: '23%', height: '12%' },
  { id: 'notes', label: '小纸条', left: '77%', top: '59%', width: '23%', height: '12%' },
  { id: 'todo', label: '待办', left: '26%', top: '68%', width: '21%', height: '12%' },
  { id: 'memory', label: '记忆', left: '64%', top: '68%', width: '22%', height: '13%' },
  { id: 'dreams', label: '现实与梦境', left: '42%', top: '73%', width: '24%', height: '14%' },
] as const

export function Sidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen } = useApp()
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

  const open = (tab: (typeof entrances)[number]['id'] | 'chat') => {
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
          className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-[#F1E9DF]"
        >
          <div
            className="relative aspect-[426/923] max-h-dvh overflow-hidden"
            style={{ width: 'min(100vw, calc(100dvh * 426 / 923), 520px)' }}
          >
            <Image
              src="/directory/home/composition.png"
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

            {entrances.map(entrance => (
              <motion.button
                key={entrance.id}
                type="button"
                onClick={() => open(entrance.id)}
                aria-label={entrance.label}
                aria-current={activeTab === entrance.id ? 'page' : undefined}
                whileTap={{ scale: 0.94 }}
                className="absolute z-10 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B78337]/55"
                style={{ left: entrance.left, top: entrance.top, width: entrance.width, height: entrance.height }}
              />
            ))}

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
