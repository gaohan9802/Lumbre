'use client'

import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import type { ContentBlock } from '@/features/chat/state/types'

interface StreamingReplyProps {
  blocks: ContentBlock[]
  expandedThinking: Set<string>
  onToggleThinking: (id: string) => void
  isNight: boolean
}

export function StreamingReply({
  blocks, expandedThinking, onToggleThinking, isNight,
}: StreamingReplyProps) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
      <div className="w-full space-y-1">
        {blocks.length > 0 ? blocks.map((block, index) => {
          const isLast = index === blocks.length - 1
          if (block.type === 'thinking' && block.content) {
            const key = `stream-b${index}`
            const expanded = expandedThinking.has(key)
            return (
              <div key={index}>
                <button onClick={() => onToggleThinking(key)} className={`ml-4 text-xs flex items-center gap-1 max-w-full ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
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
                  <span className={isNight ? 'text-night-muted' : 'text-day-pink'}>🔧</span>
                  <span>调用工具: <span className={`font-medium ${isNight ? 'text-night-muted' : 'text-day-pink'}`}>{block.name}</span></span>
                  <ChevronDown size={12} className="ml-auto -rotate-90" />
                </div>
              </div>
            )
          }
          if (block.type === 'text' && typeof block.content === 'string' && block.content.trim()) {
            return (
              <motion.div key={index} initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} className={`chat-ai-bubble relative block w-fit max-w-[88%] mr-auto whitespace-pre-wrap break-words px-4 py-3 text-justify [text-justify:inter-ideograph] text-[14px] leading-relaxed ${isNight ? 'text-night-text' : 'text-[#3f2c29]'}`}>
                {block.content}{isLast && <span className="stream-cursor">…</span>}
              </motion.div>
            )
          }
          return null
        }) : (
          <div className={`chat-ai-bubble relative w-fit max-w-[88%] mr-auto px-4 py-3 ${isNight ? 'text-night-text' : 'text-[#3f2c29]'}`}>
            <div className="flex gap-1">
              {[0, 1, 2].map(index => (
                <motion.div key={index} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: index * 0.2 }}
                  className={`w-1.5 h-1.5 rounded-full ${isNight ? 'bg-night-muted' : 'bg-[#DBB9B3]'}`} />
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}
