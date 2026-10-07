import type { Metadata } from 'next'
import { GuestbookPublicPage } from './GuestbookPublicPage'

export const metadata: Metadata = {
  title: '告状簿 · Lumbre',
  description: '小火、星星和访客的小纸条',
  manifest: '/guestbook-manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: '告状簿' },
  robots: { index: false, follow: false },
}

export default function GuestbookPage() {
  return <GuestbookPublicPage />
}
