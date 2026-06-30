// Global state store
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Tab = 'chat' | 'diary' | 'notes' | 'todo' | 'calendar' | 'memory'

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
    { name: 'starfire-app' }
  )
)
