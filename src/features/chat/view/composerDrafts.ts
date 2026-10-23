import type { SetStateAction } from 'react'
import type { SharedCard } from '@/lib/share'
import type { ChatAttachment } from '@/features/chat/state/types'
import type { StickerRef } from '@/lib/stickers'

export interface ChatComposerDraft {
  input: string
  pendingImages: string[]
  pendingAttachments: ChatAttachment[]
  pendingShare: SharedCard | null
  pendingSticker: StickerRef | null
}

export const EMPTY_CHAT_COMPOSER_DRAFT: ChatComposerDraft = {
  input: '',
  pendingImages: [],
  pendingAttachments: [],
  pendingShare: null,
  pendingSticker: null,
}

export function updateComposerDraft<K extends keyof ChatComposerDraft>(
  drafts: Record<string, ChatComposerDraft>,
  sessionId: string,
  field: K,
  action: SetStateAction<ChatComposerDraft[K]>,
): Record<string, ChatComposerDraft> {
  const current = drafts[sessionId] || EMPTY_CHAT_COMPOSER_DRAFT
  const value = typeof action === 'function'
    ? (action as (previous: ChatComposerDraft[K]) => ChatComposerDraft[K])(current[field])
    : action
  return { ...drafts, [sessionId]: { ...current, [field]: value } }
}
