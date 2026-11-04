'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import type { ContentBlock } from '@/features/chat/state/types'
import { MarkdownText } from '@/components/chat/MarkdownText'
import { toolDisplayInput, toolDisplayLabel } from '@/features/chat/tool-display'
import { ToolSticker } from '@/components/chat/StickerPicker'
import { ThinkingBubbles } from './ThinkingBubbles'
import { presentAssistantBlocks } from '@/lib/chat-bubble-rules'

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
  const displayBlocks = useMemo(
    () => presentAssistantBlocks(blocks, { streaming: true }),
    [blocks],
  )
  const renderBlocks = useMemo(() => displayBlocks.filter(block => block.type !== 'thinking'), [displayBlocks])
  const [visibleCount, setVisibleCount] = useState(1)

  useEffect(() => {
    if (visibleCount >= renderBlocks.length) return
    const timer = window.setTimeout(() => setVisibleCount(count => Math.min(count + 1, renderBlocks.length)), 750)
    return () => window.clearTimeout(timer)
  }, [renderBlocks.length, visibleCount])

  const visibleBlocks = renderBlocks.slice(0, Math.max(1, visibleCount))

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
      <div className="w-full space-y-2">
        {thinkingParts.length > 0 && (
          <button type="button" aria-label="打开星星的小算盘" onClick={() => onOpenThinking(thinkingParts)} className="chat-theme-icon chat-theme-muted ml-4 inline-grid h-5 w-5 place-items-center rounded-full">
            <ThinkingBubbles />
          </button>
        )}
        {renderBlocks.length > 0 ? visibleBlocks.map((block, index) => {
          const isLast = index === visibleBlocks.length - 1 && visibleCount >= renderBlocks.length
          if (block.type === 'tool_call' && block.name) {
            const key = `stream-tool-${block.callId || index}`
            if (block.name === 'send_sticker') return <ToolSticker key={key} input={block.input} pending={block.pending} />
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
            const action = block.presentation === 'action'
            return (
              <motion.div key={index} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} className={action
                ? 'chat-action-line relative mr-auto block max-w-[88%] break-words px-4 py-1.5 text-[14px]'
                : 'chat-ai-bubble chat-theme-surface relative mr-auto block w-fit max-w-[88%] break-words rounded-[18px] rounded-bl-md px-4 py-2.5 text-[14px]'}>
                <MarkdownText content={block.content} cursor={isLast} />
              </motion.div>
            )
          }
          return null
        }) : (
          <div className="chat-ai-bubble relative w-full px-4 py-2">
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
