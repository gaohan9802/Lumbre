'use client'

import Image from 'next/image'
import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { MoonStar, Sun, X } from 'lucide-react'
import { useApp } from '@/lib/store'
import { useTheme } from '@/lib/theme'

const entrances = [
  { id: 'stories', label: '枕边集', src: '/directory/home/stories.png', imageWidth: 1448, imageHeight: 1086, left: '2%', top: '25%', width: '20%', height: '13%', art: '88%', rotate: -6 },
  { id: 'poems', label: '共诗', src: '/directory/home/poems.png', imageWidth: 1254, imageHeight: 1254, left: '22%', top: '16%', width: '18%', height: '13%', art: '74%', rotate: -8 },
  { id: 'research', label: '星野手记', src: '/directory/home/research.png', imageWidth: 1254, imageHeight: 1254, left: '42%', top: '11%', width: '18%', height: '14%', art: '68%', rotate: 3 },
  { id: 'timeline', label: 'Timeline', src: '/directory/home/timeline.png', imageWidth: 1254, imageHeight: 1254, left: '63%', top: '16%', width: '18%', height: '13%', art: '70%', rotate: 7 },
  { id: 'diary', label: '日记', src: '/directory/home/diary.png', imageWidth: 1448, imageHeight: 1086, left: '79%', top: '27%', width: '18%', height: '13%', art: '75%', rotate: 8 },
  { id: 'photos', label: '照片', src: '/directory/home/photos.png', imageWidth: 1448, imageHeight: 1086, left: '2%', top: '58%', width: '20%', height: '14%', art: '78%', rotate: -6 },
  { id: 'todo', label: '待办', src: '/directory/home/todo.png', imageWidth: 1222, imageHeight: 1287, left: '22%', top: '70%', width: '18%', height: '14%', art: '66%', rotate: -5 },
  { id: 'dreams', label: '现实与梦境', src: '/directory/home/dreams.png', imageWidth: 1122, imageHeight: 1402, left: '41%', top: '74%', width: '18%', height: '15%', art: '68%', rotate: 1 },
  { id: 'memory', label: '记忆', src: '/directory/home/memory.png', imageWidth: 1225, imageHeight: 1284, left: '62%', top: '70%', width: '18%', height: '14%', art: '58%', rotate: 6 },
  { id: 'notes', label: '小纸条', src: '/directory/home/notes.png', imageWidth: 1254, imageHeight: 1254, left: '79%', top: '58%', width: '18%', height: '14%', art: '72%', rotate: 8 },
] as const

function WanderingVine() {
  return (
    <svg viewBox="0 0 390 844" aria-hidden className="pointer-events-none absolute inset-0 h-full w-full">
      <g fill="none" stroke="#5A3D31" strokeLinecap="round" strokeLinejoin="round">
        <path d="M52 274C36 251 54 225 78 220c22-5 16-34 40-38 20-4 28-25 47-13 18 12 19-19 39-25" strokeWidth="2.1" />
        <path d="M214 142c22-13 27 16 47 18 23 3 18 29 39 36 25 8 12 38 34 49 18 9 4 34 13 49" strokeWidth="1.65" />
        <path d="M348 315c13 30-10 54-1 86 9 33-16 52-5 84 12 31-16 46-10 74 6 27-26 31-22 57 4 26-25 27-34 51-8 22-35 9-52 27" strokeWidth="2.2" />
        <path d="M48 292c-13 34 12 57 0 89-12 32 11 57-2 87-14 31 12 48 4 76-8 28 19 37 23 61 4 26 34 19 40 44 6 24 37 20 53 42 13 18 28 4 37 13" strokeWidth="1.75" />
        <path d="M56 366c-25-4-23 25-3 27 15 2 23-17 7-24M333 352c22-16 33 9 14 21-12 8-23-4-14-21M91 612c-18 14-4 34 12 22M288 603c20 10 12 31-5 27" strokeWidth="1.45" />
        <path d="M73 220c-15-18-29 2-14 14M204 144c-7-23-28-7-18 9M166 691c-9 24 15 32 24 12M224 694c13 20 31 3 18-11" strokeWidth="1.85" />
        <path d="M47 468c-16-11-21-23-19-37M72 605c-13 10-20 22-20 37M342 484c16-10 23-22 24-35M310 616c15 8 25 19 29 32" strokeWidth="1.25" />
        <path d="M28 431c-12-8-13-20-2-18 9 1 10 11 2 18M52 642c-12-5-15-16-4-16 9 0 11 9 4 16M366 449c10-10 20-7 16 3-4 8-11 8-16-3M339 648c11-9 21-4 16 5-4 8-12 7-16-5" strokeWidth="1.15" />
      </g>
      <g fill="#B78337" opacity=".82">
        <circle cx="101" cy="187" r="1.7" />
        <circle cx="258" cy="160" r="1.4" />
        <circle cx="48" cy="544" r="1.5" />
        <circle cx="333" cy="559" r="1.6" />
      </g>
    </svg>
  )
}

export function Sidebar() {
  const { activeTab, setActiveTab, sidebarOpen, setSidebarOpen } = useApp()
  const { theme, toggle } = useTheme()
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
          className="fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-[#F3ECE1] text-[#51382D]"
          style={{
            backgroundImage:
              'radial-gradient(circle at 18% 24%, rgba(99,73,51,.035) 0 1px, transparent 1.3px), radial-gradient(circle at 78% 70%, rgba(99,73,51,.025) 0 1px, transparent 1.2px), repeating-linear-gradient(17deg, rgba(103,78,53,.014) 0 1px, transparent 1px 6px)',
            backgroundSize: '17px 19px, 23px 21px, auto',
          }}
        >
          <div
            className="relative aspect-[390/844] max-h-dvh overflow-hidden"
            style={{ width: 'min(100vw, calc(100dvh * 390 / 844), 520px)' }}
          >
            <button
              type="button"
              onClick={toggle}
              aria-label={theme === 'night' ? '切换到日间模式' : '切换到夜间模式'}
              className="absolute left-3 z-30 grid h-11 w-11 place-items-center rounded-full text-[#8B725E] transition-colors hover:text-[#51382D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B78337]/40"
              style={{ top: 'max(.5rem, env(safe-area-inset-top))' }}
            >
              {theme === 'night' ? <Sun size={17} strokeWidth={1.4} /> : <MoonStar size={17} strokeWidth={1.4} />}
            </button>
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              aria-label="关闭目录"
              className="absolute right-3 z-30 grid h-11 w-11 place-items-center rounded-full text-[#8B725E] transition-colors hover:text-[#51382D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B78337]/40"
              style={{ top: 'max(.5rem, env(safe-area-inset-top))' }}
            >
              <X size={18} strokeWidth={1.4} />
            </button>

            <WanderingVine />

            <div className="absolute left-1/2 top-[49%] z-10 h-[34%] w-[66%] -translate-x-1/2 -translate-y-1/2">
              <motion.button
                type="button"
                onClick={() => open('chat')}
                aria-label="星星"
                aria-current={activeTab === 'chat' ? 'page' : undefined}
                whileHover={reduceMotion ? undefined : { scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                className="relative h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B78337]/45"
              >
                <Image
                  src="/directory/home/chat-leopard.png"
                  alt=""
                  fill
                  priority
                  unoptimized
                  sizes="(max-width: 520px) 66vw, 340px"
                  className="pointer-events-none object-contain"
                />
              </motion.button>
            </div>

            {entrances.map((entrance) => (
              <div
                key={entrance.id}
                className="absolute z-20 grid place-items-center"
                style={{
                  left: entrance.left,
                  top: entrance.top,
                  width: entrance.width,
                  height: entrance.height,
                  transform: `rotate(${entrance.rotate}deg)`,
                }}
              >
                <motion.button
                  type="button"
                  onClick={() => open(entrance.id)}
                  aria-label={entrance.label}
                  aria-current={activeTab === entrance.id ? 'page' : undefined}
                  whileHover={reduceMotion ? undefined : { scale: 1.08 }}
                  whileTap={{ scale: 0.92 }}
                  className="grid h-full w-full place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#B78337]/45"
                >
                  <Image
                    src={entrance.src}
                    alt=""
                    width={entrance.imageWidth}
                    height={entrance.imageHeight}
                    unoptimized
                    sizes="(max-width: 520px) 18vw, 94px"
                    className="pointer-events-none h-auto object-contain"
                    style={{ width: entrance.art }}
                  />
                </motion.button>
              </div>
            ))}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
