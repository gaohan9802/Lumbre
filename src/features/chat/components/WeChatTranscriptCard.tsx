'use client'

import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ChatMessage } from '@/features/chat/state/types'
import { MarkdownText } from '@/components/chat/MarkdownText'
import { StickerArt } from '@/components/chat/StickerPicker'
import { sticker } from '@/lib/stickers'

function time(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value))
}

function preview(message: ChatMessage) {
  if (message.content.trim()) return message.content.trim().replace(/\s+/g, ' ')
  if (message.images?.length) return '[图片]'
  if (message.sticker) return `[表情：${sticker(message.sticker.id)?.label || '表情'}]`
  return '[微信消息]'
}

export function WeChatTranscriptCard({ messages }: { messages: ChatMessage[] }) {
  const [open, setOpen] = useState(false)
  const ordered = [...messages].sort((a, b) => a.timestamp - b.timestamp)
  const first = ordered[0]
  const last = ordered.at(-1)!
  return (
    <section className="chat-theme-surface chat-theme-border mx-auto mb-4 w-full max-w-[94%] overflow-hidden rounded-2xl border">
      <button
        type="button"
        aria-expanded={open}
        onClick={event => { event.stopPropagation(); setOpen(value => !value) }}
        className="chat-theme-hover flex w-full items-center gap-3 px-3.5 py-3 text-left"
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#07c160]/10 text-sm">微信</span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-xs font-medium">
            微信短聊
            <span className="text-[10px] font-normal opacity-45">{messages.length} 条 · {time(first.timestamp)}{first !== last ? `–${time(last.timestamp)}` : ''}</span>
          </span>
          {!open && <span className="mt-0.5 block truncate text-[11px] opacity-50">{last.role === 'user' ? '你' : '星星'}：{preview(last)}</span>}
        </span>
        <ChevronDown size={15} className={`shrink-0 opacity-45 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="chat-theme-border max-h-[58vh] space-y-3 overflow-y-auto border-t px-3 py-3">
          {ordered.map(message => (
            <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[86%] ${message.role === 'user' ? 'chat-theme-user rounded-2xl rounded-br-md' : 'chat-ai-bubble'} px-3 py-2 text-[13px] leading-relaxed`}>
                {!!message.images?.length && <div className="mb-1.5 flex flex-wrap gap-1.5">{message.images.map((src, index) => <img key={`${message.id}-${index}`} src={src} alt="微信图片" loading="lazy" decoding="async" className="max-h-44 max-w-[180px] rounded-lg object-cover" />)}</div>}
                {message.sticker && sticker(message.sticker.id) && <StickerArt id={message.sticker.id} className="h-24 w-24" />}
                {!!message.content.trim() && <MarkdownText content={message.content} />}
                <div className={`mt-1 text-[9px] opacity-35 ${message.role === 'user' ? 'text-right' : 'text-left'}`}>{time(message.timestamp)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
