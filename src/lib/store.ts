// Global state store
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Tab = 'chat' | 'timeline' | 'diary' | 'notes' | 'todo' | 'photos' | 'memory' | 'dreams' | 'tesis' | 'wishlist'

const VALID_TABS: Tab[] = ['chat', 'timeline', 'diary', 'notes', 'todo', 'photos', 'memory', 'dreams', 'tesis', 'wishlist']

interface AppStore {
  // Navigation
  activeTab: Tab
  setActiveTab: (tab: Tab) => void

  // User identity (who's using the device)
  currentUser: 'star' | 'fire'
  setCurrentUser: (user: 'star' | 'fire') => void

  // Sidebar
  sidebarOpen: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
}

export const useApp = create<AppStore>()(
  persist(
    (set) => ({
      activeTab: 'chat',
      setActiveTab: (tab) => set({ activeTab: tab }),

      currentUser: 'fire',
      setCurrentUser: (user) => set({ currentUser: user }),

      sidebarOpen: false,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name: 'starfire-app',
      version: 7,
      migrate: (persisted: any) => {
        if (persisted?.state && !VALID_TABS.includes(persisted.state.activeTab)) {
          persisted.state.activeTab = 'chat'
        }
        return persisted
      },
    }
  )
)
