'use client'

import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import type { ContentBlock } from '@/features/chat/state/types'
import { MarkdownText } from '@/components/chat/MarkdownText'
import { toolDisplayLabel } from '@/features/chat/tool-display'

interface StreamingReplyProps {
  blocks: ContentBlock[]
  expandedThinking: Set<string>
  onToggleThinking: (id: string) => void
  expandedTools: Set<string>
  onToggleTools: (id: string) => void
  isNight: boolean
}

export function StreamingReply({
  blocks, expandedThinking, onToggleThinking, expandedTools, onToggleTools, isNight,
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
                <button onClick={() => onToggleThinking(key)} className={`ml-4 flex max-w-full items-center gap-1 text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
                  <span className="truncate">💭星星的小算盘{!expanded && isLast ? <span className="stream-cursor">…</span> : ''}</span>
                </button>
                {expanded && (
                  <div className={`ml-4 mt-1 max-w-[calc(88%_-_1rem)] text-left text-[13px] leading-relaxed ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
                    <MarkdownText content={block.content} cursor={isLast}/>
                  </div>
                )}
              </div>
            )
          }
          if (block.type === 'tool_call' && block.name) {
            const key = `stream-tool-${block.callId || index}`
            const expanded = expandedTools.has(key)
            return (
              <div key={key} className={`w-fit max-w-[87%] mr-auto rounded-xl border ${isNight ? 'border-night-border bg-night-surface/40' : 'border-gray-200 bg-gray-50/60'}`}>
                <button onClick={() => onToggleTools(key)} className={`w-full flex items-center gap-2 px-3 py-2 text-xs ${isNight ? 'text-night-muted' : 'text-day-muted'}`}>
                  <span className={`${block.pending ? 'animate-pulse' : ''} ${isNight ? 'text-night-muted' : 'text-day-pink'}`}>🔧</span>
                  <span className={`font-medium ${isNight ? 'text-night-muted' : 'text-day-pink'}`}>{toolDisplayLabel(block.name)}</span>
                  {block.pending && <span className="text-[10px] opacity-45">进行中</span>}
                  <ChevronDown size={12} className={`ml-auto transition-transform flex-shrink-0 ${expanded ? '' : '-rotate-90'}`} />
                </button>
                {expanded && (
                  <div className="px-3 pb-2 text-xs space-y-1.5">
                    {block.input && Object.keys(block.input).length > 0 && (
                      <pre className={`text-[10px] leading-relaxed whitespace-pre-wrap break-all p-1.5 rounded ${isNight ? 'bg-night-card text-night-muted' : 'bg-white text-day-muted'}`}>
                        {JSON.stringify(block.input, null, 2)}
                      </pre>
                    )}
                    <div className={`pt-1 border-t ${isNight ? 'border-night-border' : 'border-gray-200'}`}>
                      <span className="text-[10px] opacity-40 block mb-1">返回结果</span>
                      <pre className={`text-[10px] leading-relaxed whitespace-pre-wrap break-all p-1.5 rounded max-h-[200px] overflow-y-auto ${isNight ? 'bg-night-card text-night-muted' : 'bg-white text-day-muted'}`}>
                        {block.pending ? '等待返回…' : block.result || '（无返回内容）'}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )
          }
          if (block.type === 'text' && typeof block.content === 'string' && block.content.trim()) {
            return (
              <motion.div key={index} initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} className={`chat-ai-bubble relative mr-auto block w-fit max-w-[88%] whitespace-pre-wrap break-words px-4 py-3 text-left text-[14px] leading-relaxed ${isNight ? 'text-night-text' : 'text-[#3f2c29]'}`}>
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
