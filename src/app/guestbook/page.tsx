import type { Metadata } from 'next'
import { GuestbookPublicPage } from './GuestbookPublicPage'

export const metadata: Metadata = { title: '告状簿 · Lumbre', robots: { index: false, follow: false } }

export default function GuestbookPage() {
  return <GuestbookPublicPage />
}
