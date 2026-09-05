'use client'

import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { ContentBlock } from '@/features/chat/state/types'

interface StreamingReplyProps {
  blocks: ContentBlock[]
  expandedThinking: Set<string>
  onToggleThinking: (id: string) => void
  isNight: boolean
  aiColor?: string
  aiBubbleStyle: CSSProperties
}

export function StreamingReply({
  blocks, expandedThinking, onToggleThinking, isNight, aiColor, aiBubbleStyle,
}: StreamingReplyProps) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
      <div className="w-full space-y-1.5">
        {blocks.length > 0 ? blocks.map((block, index) => {
          const isLast = index === blocks.length - 1
          if (block.type === 'thinking' && block.content) {
            const key = `stream-b${index}`
            const expanded = expandedThinking.has(key)
            return (
              <div key={index}>
                <button onClick={() => onToggleThinking(key)} className={`text-xs flex items-center gap-1 max-w-full ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
                  <ChevronDown size={12} className={`transition-transform flex-shrink-0 ${expanded ? '' : '-rotate-90'}`} />
                  <span className="truncate">💭星星的小算盘{!expanded && isLast ? <span className="stream-cursor">…</span> : ''}</span>
                </button>
                {expanded && (
                  <div className={`text-[13px] p-2 rounded-lg whitespace-pre-wrap ${isNight ? 'bg-night-surface text-night-muted' : 'bg-gray-50 text-day-muted'}`}>
                    {block.content}{isLast ? <span className="stream-cursor">…</span> : ''}
                  </div>
                )}
              </div>
            )
          }
          if (block.type === 'tool_call' && block.name) {
            return (
              <div key={index} className={`w-fit max-w-[87%] mr-auto rounded-xl border ${isNight ? 'border-night-border bg-night-surface/40' : 'border-gray-200 bg-gray-50/60'}`}>
                <div className={`flex items-center gap-2 px-3 py-2 text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
                  <span className={isNight ? 'text-night-amber' : 'text-day-pink'}>🔧</span>
                  <span>调用工具: <span className={`font-medium ${isNight ? 'text-night-amber' : 'text-day-pink'}`}>{block.name}</span></span>
                  <ChevronDown size={12} className="ml-auto -rotate-90" />
                </div>
              </div>
            )
          }
          if (block.type === 'text' && typeof block.content === 'string' && block.content.trim()) {
            return (
              <div key={index} className={`block w-fit max-w-[87%] mr-auto whitespace-pre-wrap break-words px-4 py-3 rounded-2xl rounded-bl-md text-[14px] leading-relaxed  ${!aiColor ? (isNight ? 'bg-night-surface text-night-text' : 'bg-white shadow-sm text-day-text') : ''}`} style={aiBubbleStyle}>
                {block.content}{isLast && <span className="stream-cursor">…</span>}
              </div>
            )
          }
          return null
        }) : (
          <div className={`w-fit max-w-[87%] mr-auto px-4 py-3 rounded-2xl rounded-bl-md  ${!aiColor ? (isNight ? 'bg-night-surface' : 'bg-white shadow-sm') : ''}`} style={aiBubbleStyle}>
            <div className="flex gap-1">
              {[0, 1, 2].map(index => (
                <motion.div key={index} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: index * 0.2 }}
                  className={`w-1.5 h-1.5 rounded-full ${isNight ? 'bg-night-amber' : 'bg-day-pink'}`} />
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}
