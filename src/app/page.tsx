'use client'

import { useApp } from '@/lib/store'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { ChatView } from '@/components/chat/ChatView'
import { DiaryView } from '@/components/diary/DiaryView'
import { NotesView } from '@/components/notes/NotesView'
import { TodoView } from '@/components/todo/TodoView'
import { CalendarView } from '@/components/calendar/CalendarView'
import { MemoryView } from '@/components/memory/MemoryView'
import { ChatSync } from '@/components/chat/ChatSync'
import { motion, AnimatePresence } from 'framer-motion'

const views = {
  chat: ChatView,
  diary: DiaryView,
  notes: NotesView,
  todo: TodoView,
  calendar: CalendarView,
  memory: MemoryView,
}

export default function Home() {
  const { activeTab } = useApp()
  const View = views[activeTab]

  return (
    <div className="flex h-dvh overflow-hidden">
      <ChatSync />
      <Sidebar />
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <TopBar />
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="flex-1 overflow-hidden"
          >
            <View />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  )
}
