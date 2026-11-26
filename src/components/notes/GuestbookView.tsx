'use client'

import { GuestbookBoard } from './GuestbookBoard'
import { useTheme } from '@/lib/theme'

export function GuestbookView() {
  const night = useTheme(state => state.theme === 'night')
  return (
    <div className={`flex h-full flex-col ${night ? 'bg-night-bg text-night-text' : 'chat-paper text-[#3f2c29]'}`}>
      <GuestbookBoard actor="fire" endpoint="/api/guestbook?mark_read=1" onLoaded={() => window.dispatchEvent(new CustomEvent('lumbre-guestbook-read'))}/>
    </div>
  )
}
