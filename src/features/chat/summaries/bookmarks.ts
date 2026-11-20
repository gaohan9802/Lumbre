import type { Bookmark, ChatMessage } from '../state/types'

export function formatBookmarkBlock(items: Bookmark[]) {
  return items.length ? `[书签提醒]\n${items.map(bookmark => bookmark.content).join('\n---\n')}` : ''
}

export function getTriggeredBookmarks(bookmarks: Bookmark[], recentMessages: ChatMessage[]): Bookmark[] {
  const triggered: Bookmark[] = []
  for (const bookmark of bookmarks) {
    if (!bookmark.enabled) continue
    if (bookmark.alwaysOn) {
      triggered.push(bookmark)
      continue
    }
    const text = recentMessages
      .slice(-bookmark.scanDepth)
      .map(message => message.content)
      .join(' ')
      .toLowerCase()
    if (bookmark.keywords.some(keyword => keyword && text.includes(keyword.toLowerCase()))) {
      triggered.push(bookmark)
    }
  }
  return triggered.sort((a, b) => b.priority - a.priority)
}
