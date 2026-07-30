'use client'

import { useApp } from '@/lib/store'
import { Sidebar } from '@/components/layout/Sidebar'
import { TopBar } from '@/components/layout/TopBar'
import { ChatView } from '@/components/chat/ChatView'
import { DiaryView } from '@/components/diary/DiaryView'
import { NotesView } from '@/components/notes/NotesView'
import { TodoView } from '@/components/todo/TodoView'
import { PhotosView } from '@/components/photos/PhotosView'
import { MemoryView } from '@/components/memory/MemoryView'
import { CoReadingView } from '@/components/coreading/CoReadingView'
import { DreamsView } from '@/components/dreams/DreamsView'
import { TesisView } from '@/components/tesis/TesisView'
import { WishlistView } from '@/components/wishlist/WishlistView'
import { ChatSync } from '@/components/chat/ChatSync'
import { motion, AnimatePresence } from 'framer-motion'

const views = {
  chat: ChatView,
  
  diary: DiaryView,
  notes: NotesView,
  todo: TodoView,
  photos: PhotosView,
  memory: MemoryView,
  coreading: CoReadingView,
  dreams: DreamsView,
  tesis: TesisView,
  wishlist: WishlistView,
}

export default function Home() {
  const { activeTab } = useApp()
  const View = views[activeTab] || ChatView

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
