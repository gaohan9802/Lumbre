'use client'

import { useState, useRef, useEffect } from 'react'
import { useTheme } from '@/lib/theme'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, ChevronDown, Settings2 } from 'lucide-react'
import { useChatStore, ChatMessage, getActiveProfile } from '@/lib/chatStore'
import { chat } from '@/lib/api'
import { ChatSettings } from './ChatSettings'

export function ChatView() {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const { messages, settings, addMessage } = useChatStore()
  const activeProfile = getActiveProfile(settings)

  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [expandedThinking, setExpandedThinking] = useState<Set<string>>(new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  // auto-grow textarea
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [input])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    }
    addMessage(userMsg)
    setInput('')
    setIsLoading(true)

    try {
      // slice context per settings
      const history = [...messages, userMsg]
      const slice = history.slice(-settings.contextLength)

      const data = await chat.send({
        messages: slice.map((m) => ({ role: m.role, content: m.content })),
        system: settings.systemPrompt || undefined,
        model: settings.model,
        thinking_budget: settings.thinkingBudget,
        prompt_caching: settings.promptCaching,
        api_profile: activeProfile ? {
          provider: activeProfile.provider,
          baseUrl: activeProfile.baseUrl,
          apiKey: activeProfile.apiKey,
        } : undefined,
      })

      addMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.content || data.error || '...',
        timestamp: Date.now(),
        thinking: data.thinking,
        input_tokens: data.input_tokens,
        output_tokens: data.output_tokens,
        cache_read_tokens: data.cache_read_tokens,
        cache_creation_tokens: data.cache_creation_tokens,
      })
    } catch (err: any) {
      addMessage({
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: err?.message || '连接失败了…',
        timestamp: Date.now(),
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const toggleThinking = (id: string) => {
    setExpandedThinking((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const formatTime = (ts: number) =>
    new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })

  // last assistant cache status for the badge
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const cacheHit = lastAssistant?.cache_read_tokens && lastAssistant.cache_read_tokens > 0

  return (
    <>
      <div className="flex flex-col h-full">
        {/* header: only on desktop because TopBar handles mobile */}
        <div className="hidden md:flex px-6 py-3 items-center justify-between border-b border-current/5">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-medium opacity-80">💬 对话</h2>
            <span className="text-[10px] opacity-40">{settings.model}</span>
            {cacheHit && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                isNight ? 'bg-night-amber/10 text-night-amber' : 'bg-day-pink/10 text-day-heart'
              }`}>
                cache ↻ {lastAssistant?.cache_read_tokens}
              </span>
            )}
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            className={`p-2 rounded-xl transition ${
              isNight ? 'hover:bg-night-surface text-night-muted' : 'hover:bg-gray-100 text-day-muted'
            }`}
          >
            <Settings2 size={16} />
          </button>
        </div>

        {/* mobile gear button — floating */}
        <button
          onClick={() => setSettingsOpen(true)}
          className={`md:hidden absolute top-3 right-3 z-20 p-2 rounded-xl ${
            isNight ? 'bg-night-card/80 text-night-muted' : 'bg-white/80 text-day-muted'
          } backdrop-blur-md`}
        >
          <Settings2 size={16} />
        </button>

        {/* messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-3 opacity-40">
              <span className="text-4xl">🏠</span>
              <p className="text-sm">说点什么吧</p>
            </div>
          )}

          <AnimatePresence initial={false}>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div className="max-w-[85%] sm:max-w-[80%] space-y-1">
                  {msg.thinking && (
                    <button
                      onClick={() => toggleThinking(msg.id)}
                      className={`text-xs flex items-center gap-1 ${
                        isNight ? 'text-night-muted' : 'text-day-muted'
                      }`}
                    >
                      <ChevronDown
                        size={12}
                        className={`transition-transform ${expandedThinking.has(msg.id) ? 'rotate-180' : ''}`}
                      />
                      Thinking
                    </button>
                  )}
                  <AnimatePresence>
                    {msg.thinking && expandedThinking.has(msg.id) && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className={`text-xs p-2 rounded-lg overflow-hidden whitespace-pre-wrap ${
                          isNight ? 'bg-night-surface text-night-muted' : 'bg-gray-50 text-day-muted'
                        }`}
                      >
                        {msg.thinking}
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <div
                    className={`
                      px-4 py-3 rounded-2xl text-sm leading-relaxed
                      ${msg.role === 'user'
                        ? isNight
                          ? 'bg-night-amber/20 text-night-text rounded-br-md'
                          : 'bg-day-pink/20 text-day-text rounded-br-md'
                        : isNight
                          ? 'bg-night-surface text-night-text rounded-bl-md'
                          : 'bg-white shadow-sm text-day-text rounded-bl-md'}
                    `}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>

                  <p
                    className={`text-[10px] px-1 ${
                      msg.role === 'user' ? 'text-right' : 'text-left'
                    } ${isNight ? 'text-night-muted' : 'text-day-muted'}`}
                  >
                    {formatTime(msg.timestamp)}
                    {msg.role === 'assistant' && msg.input_tokens && (
                      <span className="opacity-60 ml-2">
                        ↓{msg.input_tokens} ↑{msg.output_tokens}
                        {msg.cache_read_tokens ? ` ↻${msg.cache_read_tokens}` : ''}
                      </span>
                    )}
                  </p>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex justify-start"
            >
              <div className={`px-4 py-3 rounded-2xl rounded-bl-md ${
                isNight ? 'bg-night-surface' : 'bg-white shadow-sm'
              }`}>
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                      className={`w-1.5 h-1.5 rounded-full ${
                        isNight ? 'bg-night-amber' : 'bg-day-pink'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* input */}
        <div
          className={`
            p-4 border-t backdrop-blur-md
            ${isNight ? 'border-night-border bg-night-card/50' : 'border-day-muted/10 bg-white/50'}
            pb-[max(1rem,env(safe-area-inset-bottom))]
          `}
        >
          <div className={`flex items-end gap-2 px-4 py-2 rounded-2xl ${isNight ? 'bg-night-surface' : 'bg-gray-50'}`}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="说点什么..."
              rows={1}
              enterKeyHint="send"
              className={`
                flex-1 resize-none bg-transparent outline-none text-sm py-1 max-h-40
                ${isNight ? 'text-night-text placeholder:text-night-muted' : 'text-day-text placeholder:text-day-muted'}
              `}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className={`
                p-2 rounded-xl transition-all flex-shrink-0
                ${input.trim()
                  ? isNight
                    ? 'bg-night-amber text-night-bg hover:bg-night-amberGlow'
                    : 'bg-day-pink text-white hover:bg-day-heart'
                  : 'opacity-30 cursor-not-allowed'}
              `}
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

      <ChatSettings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  )
}
