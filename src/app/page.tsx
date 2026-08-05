'use client'

import dynamic from 'next/dynamic'
import { useApp } from '@/lib/store'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { motion, AnimatePresence } from 'framer-motion'

function ViewLoading() {
  return (
    <div className="h-full flex items-center justify-center" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-xs opacity-50">
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce" />
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:120ms]" />
        <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:240ms]" />
        <span className="ml-1">正在打开…</span>
      </div>
    </div>
  )
}

// Each module is a separate client chunk. Previously every large view (Chat,
// Memory, Diary, Photos...) was bundled into the initial page, so opening the
// PWA had to parse the whole application before showing anything.
const ChatSync = dynamic(() => import('@/components/chat/ChatSync').then(m => m.ChatSync), { ssr: false })
const ChatView = dynamic(() => import('@/components/chat/ChatView').then(m => m.ChatView), { loading: ViewLoading, ssr: false })
const TimelineHubView = dynamic(() => import('@/components/timeline/TimelineHubView').then(m => m.TimelineHubView), { loading: ViewLoading, ssr: false })
const DiaryView = dynamic(() => import('@/components/diary/DiaryView').then(m => m.DiaryView), { loading: ViewLoading, ssr: false })
const NotesView = dynamic(() => import('@/components/notes/NotesView').then(m => m.NotesView), { loading: ViewLoading, ssr: false })
const TodoView = dynamic(() => import('@/components/todo/TodoView').then(m => m.TodoView), { loading: ViewLoading, ssr: false })
const PhotosView = dynamic(() => import('@/components/photos/PhotosView').then(m => m.PhotosView), { loading: ViewLoading, ssr: false })
const MemoryView = dynamic(() => import('@/components/memory/MemoryView').then(m => m.MemoryView), { loading: ViewLoading, ssr: false })
const DreamsView = dynamic(() => import('@/components/dreams/DreamsView').then(m => m.DreamsView), { loading: ViewLoading, ssr: false })

const views = {
  chat: ChatView,
  timeline: TimelineHubView,
  diary: DiaryView,
  notes: NotesView,
  todo: TodoView,
  photos: PhotosView,
  memory: MemoryView,
  dreams: DreamsView,
}

export default function Home() {
  const { activeTab } = useApp()
  const View = views[activeTab] || ChatView

  return (
    <div className="h-dvh overflow-hidden">
      <ChatSync />
      <Sidebar />
      <main className="flex h-full flex-col overflow-hidden relative">
        <TopBar />
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.14 }}
            className="flex-1 overflow-hidden"
          >
            <View />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
