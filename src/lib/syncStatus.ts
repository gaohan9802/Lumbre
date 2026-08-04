import { create } from 'zustand'

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error'
interface SyncStatusState {
  phase: SyncPhase
  lastSyncedAt: number
  error: string
  setSyncStatus: (patch: Partial<Pick<SyncStatusState, 'phase' | 'lastSyncedAt' | 'error'>>) => void
  retry: () => void
}

export const useSyncStatus = create<SyncStatusState>((set) => ({
  phase: typeof navigator !== 'undefined' && !navigator.onLine ? 'offline' : 'idle',
  lastSyncedAt: 0,
  error: '',
  setSyncStatus: (patch) => set(patch),
  retry: () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('lumbre:sync-retry'))
  },
}))
