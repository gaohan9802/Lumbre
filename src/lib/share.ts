export interface SharedCard {
  kind: string
  title: string
  subtitle?: string
  body?: string
  imageUrl?: string
  metadata: Record<string, unknown>
}

export function shareToChat(card: SharedCard) {
  if (typeof window !== 'undefined') {
    try { sessionStorage.setItem('lumbre-pending-share', JSON.stringify(card)) } catch {}
    window.dispatchEvent(new CustomEvent('lumbre-navigate-chat'))
    window.dispatchEvent(new CustomEvent('lumbre-share-to-chat', { detail: card }))
  }
}
