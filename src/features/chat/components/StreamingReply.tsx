'use client'

import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import type { ContentBlock } from '@/features/chat/state/types'
import { MarkdownText } from '@/components/chat/MarkdownText'
import { toolDisplayInput, toolDisplayLabel } from '@/features/chat/tool-display'

interface StreamingReplyProps {
  blocks: ContentBlock[]
  onOpenThinking: (parts: string[]) => void
  expandedTools: Set<string>
  onToggleTools: (id: string) => void
}

export function StreamingReply({
  blocks, onOpenThinking, expandedTools, onToggleTools,
}: StreamingReplyProps) {
  const thinkingParts = blocks
    .filter((block): block is ContentBlock & { content: string } => block.type === 'thinking' && typeof block.content === 'string' && !!block.content.trim())
    .map(block => block.content)

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
      <div className="w-full space-y-1">
        {thinkingParts.length > 0 && (
          <button type="button" aria-label="打开星星的小算盘" onClick={() => onOpenThinking(thinkingParts)} className="chat-theme-muted ml-3 grid h-7 w-7 place-items-center text-sm">
            <span aria-hidden="true">💭</span>
          </button>
        )}
        {blocks.length > 0 ? blocks.map((block, index) => {
          const isLast = index === blocks.length - 1
          if (block.type === 'thinking') return null
          if (block.type === 'tool_call' && block.name) {
            const key = `stream-tool-${block.callId || index}`
            const expanded = expandedTools.has(key)
            return (
              <div key={key} className="chat-theme-surface chat-theme-border mr-auto w-fit max-w-[90%] rounded-xl border">
                <button onClick={() => onToggleTools(key)} className="chat-theme-muted flex w-full items-center gap-2 px-3 py-2 text-xs">
                  <span className={`${block.pending ? 'animate-pulse ' : ''}chat-theme-accent`}>🔧</span>
                  <span className="chat-theme-accent font-medium">{toolDisplayLabel(block.name)}</span>
                  {block.pending && <span className="text-[10px] opacity-45">进行中</span>}
                  <ChevronDown size={12} className={`ml-auto transition-transform flex-shrink-0 ${expanded ? '' : '-rotate-90'}`} />
                </button>
                {expanded && (
                  <div className="px-3 pb-2 text-xs space-y-1.5">
                    {block.input && Object.keys(block.input).length > 0 && (
                      <pre className="chat-theme chat-theme-muted rounded p-1.5 text-[10px] leading-relaxed whitespace-pre-wrap break-all">
                        {JSON.stringify(toolDisplayInput(block.name, block.input), null, 2)}
                      </pre>
                    )}
                    <div className="chat-theme-border border-t pt-1">
                      <span className="text-[10px] opacity-40 block mb-1">返回结果</span>
                      <pre className="chat-theme chat-theme-muted max-h-[200px] overflow-y-auto rounded p-1.5 text-[10px] leading-relaxed whitespace-pre-wrap break-all">
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
              <motion.div key={index} initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} className="chat-ai-bubble relative mr-auto block w-fit max-w-[91%] whitespace-pre-wrap break-words px-4 py-3 text-left text-[14px] leading-relaxed">
                {block.content}{isLast && <span className="stream-cursor">…</span>}
              </motion.div>
            )
          }
          return null
        }) : (
          <div className="chat-ai-bubble relative mr-auto w-fit max-w-[91%] px-4 py-3">
            <div className="flex gap-1">
              {[0, 1, 2].map(index => (
                <motion.div key={index} animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: index * 0.2 }}
                  className="chat-theme-accent-bg h-1.5 w-1.5 rounded-full" />
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  )
}
