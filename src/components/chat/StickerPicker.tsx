'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import {
  STICKERS, STICKER_CATEGORY_LABELS, sticker, stickerFromToolInput,
  type StickerCategory, type StickerRef,
} from '@/lib/stickers'

export function StickerArt({ id, className = 'h-24 w-24' }: { id: string; className?: string }) {
  const item = sticker(id)
  if (!item) return null
  return <img src={item.asset} alt={item.label} loading="lazy" decoding="async" className={`${className} object-contain`} />
}

export function StickerMessage({ value, caption, pending = false }: { value: StickerRef; caption?: string; pending?: boolean }) {
  if (!sticker(value.id)) return null
  return (
    <div className={`mr-auto flex w-fit max-w-[88%] items-end gap-2 ${pending ? 'opacity-60' : ''}`}>
      <StickerArt id={value.id} className="h-32 w-32 shrink-0" />
      {(caption || pending) && <div className="chat-theme-muted pb-2 text-xs">{caption || '正在走过来…'}</div>}
    </div>
  )
}

export function ToolSticker({ input, pending }: { input?: Record<string, unknown>; pending?: boolean }) {
  const value = stickerFromToolInput(input)
  if (!value) return null
  const caption = typeof input?.caption === 'string' ? input.caption.trim().slice(0, 80) : ''
  return <StickerMessage value={value} caption={caption} pending={pending} />
}

export function StickerVisit({ value, onDone }: { value: StickerRef; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, 8000)
    return () => clearTimeout(timer)
  }, [value.id, onDone])
  return <div className="pointer-events-none fixed bottom-28 right-4 z-[70] animate-[sticker-visit_8s_ease-in-out_forwards]"><StickerArt id={value.id} className="h-28 w-28 drop-shadow-lg" /></div>
}

export function StickerPicker({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (value: StickerRef) => void }) {
  const [category, setCategory] = useState<StickerCategory>('duo')
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open, onClose])
  if (!open || typeof document === 'undefined') return null
  const visible = STICKERS.filter(item => item.category === category)
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end bg-black/20 backdrop-blur-[2px]" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="选择表情包" onClick={event => event.stopPropagation()} className="chat-theme-surface max-h-[76vh] w-full overflow-hidden rounded-t-[28px] shadow-2xl">
        <div className="chat-theme-border flex items-center justify-between border-b px-5 py-3">
          <div><div className="font-medium">我们的表情包</div><div className="chat-theme-muted mt-0.5 text-[11px]">可以继续打字，会和表情一起发出</div></div>
          <button type="button" aria-label="关闭表情选择" onClick={onClose} className="chat-theme-icon grid h-8 w-8 place-items-center rounded-full"><X size={16}/></button>
        </div>
        <div className="chat-theme-border flex gap-1 border-b px-3 py-2">
          {(Object.keys(STICKER_CATEGORY_LABELS) as StickerCategory[]).map(key => (
            <button key={key} type="button" onClick={() => setCategory(key)} className={`rounded-full px-3 py-1.5 text-xs transition-colors ${category === key ? 'chat-theme-accent-bg text-[#3f2c29]' : 'chat-theme-icon'}`}>
              {STICKER_CATEGORY_LABELS[key]}
            </button>
          ))}
        </div>
        <div className="grid max-h-[calc(76vh-112px)] grid-cols-4 gap-2 overflow-y-auto p-3 sm:grid-cols-5">
          {visible.map(item => (
            <button key={item.id} type="button" title={item.description} onClick={() => { onSelect({ id: item.id, entrance: 'message' }); onClose() }} className="chat-theme-icon flex min-h-24 flex-col items-center justify-center rounded-2xl px-1 py-1.5">
              <StickerArt id={item.id} className="h-16 w-16" />
              <span className="mt-1 text-[11px]">{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
