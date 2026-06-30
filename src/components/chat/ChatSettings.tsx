'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { X, RotateCcw, Trash2 } from 'lucide-react'
import { useTheme } from '@/lib/theme'
import { useChatStore, estimateTokens } from '@/lib/chatStore'

interface Props {
  open: boolean
  onClose: () => void
}

const MODELS = [
  { id: 'claude-opus-4-5',    label: 'Opus 4.5' },
  { id: 'claude-sonnet-4-5',  label: 'Sonnet 4.5' },
  { id: 'claude-haiku-4-5',   label: 'Haiku 4.5' },
]

export function ChatSettings({ open, onClose }: Props) {
  const { theme } = useTheme()
  const isNight = theme === 'night'
  const { messages, settings, setSettings, resetSettings, clearMessages } = useChatStore()

  const systemTokens = estimateTokens(settings.systemPrompt)
  const totalMsgTokens = messages.reduce((s, m) => s + estimateTokens(m.content), 0)
  const sentSlice = messages.slice(-settings.contextLength)
  const sentTokens = sentSlice.reduce((s, m) => s + estimateTokens(m.content), 0)

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
          />
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            className={`
              fixed right-0 top-0 bottom-0 w-full sm:w-[420px] z-50 overflow-y-auto
              ${isNight ? 'bg-night-card border-l border-night-border' : 'bg-white border-l border-day-muted/10'}
              pb-[env(safe-area-inset-bottom)]
            `}
          >
            <div className="sticky top-0 backdrop-blur-md bg-inherit px-6 py-4 flex items-center justify-between border-b border-current/5">
              <h3 className="font-medium">⚙️ Chat 设置</h3>
              <button onClick={onClose} className="p-1 opacity-60 hover:opacity-100">
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Model */}
              <section className="space-y-2">
                <label className="text-xs opacity-60">模型</label>
                <div className="flex gap-2 flex-wrap">
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setSettings({ model: m.id })}
                      className={`px-3 py-1.5 rounded-lg text-xs transition ${
                        settings.model === m.id
                          ? isNight ? 'bg-night-amber text-night-bg' : 'bg-day-pink text-white'
                          : isNight ? 'bg-night-surface' : 'bg-gray-100'
                      }`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </section>

              {/* System prompt */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">System Prompt</label>
                  <span className="text-[10px] opacity-40">~{systemTokens} tok</span>
                </div>
                <textarea
                  value={settings.systemPrompt}
                  onChange={(e) => setSettings({ systemPrompt: e.target.value })}
                  rows={8}
                  placeholder="给星星定一个底色…"
                  className={`
                    w-full text-sm leading-relaxed p-3 rounded-xl outline-none resize-y
                    ${isNight
                      ? 'bg-night-surface text-night-text placeholder:text-night-muted'
                      : 'bg-gray-50 text-day-text placeholder:text-day-muted'}
                  `}
                />
              </section>

              {/* Context length */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">Context — 抓取最近多少条</label>
                  <span className="text-xs">
                    <span className={isNight ? 'text-night-amber' : 'text-day-heart'}>
                      {settings.contextLength}
                    </span>
                    <span className="opacity-40"> / {messages.length}</span>
                  </span>
                </div>
                <input
                  type="range"
                  min={4}
                  max={200}
                  step={2}
                  value={settings.contextLength}
                  onChange={(e) => setSettings({ contextLength: parseInt(e.target.value) })}
                  className="w-full accent-current"
                />
                <div className="text-[10px] opacity-40 flex justify-between">
                  <span>4</span>
                  <span>本轮发送 ~{sentTokens} tok（共 ~{totalMsgTokens}）</span>
                  <span>200</span>
                </div>
              </section>

              {/* Thinking budget */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs opacity-60">Extended Thinking</label>
                  <span className="text-xs opacity-60">{settings.thinkingBudget || 'off'}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={32000}
                  step={1000}
                  value={settings.thinkingBudget}
                  onChange={(e) => setSettings({ thinkingBudget: parseInt(e.target.value) })}
                  className="w-full"
                />
                <div className="text-[10px] opacity-40 flex justify-between">
                  <span>off</span>
                  <span>{settings.thinkingBudget > 0 ? `${settings.thinkingBudget} tok 思考预算` : '关闭'}</span>
                  <span>32k</span>
                </div>
              </section>

              {/* Prompt caching */}
              <section className="flex items-center justify-between">
                <div>
                  <p className="text-xs opacity-60">Prompt Caching</p>
                  <p className="text-[10px] opacity-40 mt-1">缓存 system + 早期对话，省 token</p>
                </div>
                <button
                  onClick={() => setSettings({ promptCaching: !settings.promptCaching })}
                  className={`relative w-10 h-6 rounded-full transition ${
                    settings.promptCaching
                      ? isNight ? 'bg-night-amber' : 'bg-day-pink'
                      : 'bg-gray-300 dark:bg-night-surface'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                      settings.promptCaching ? 'translate-x-4' : ''
                    }`}
                  />
                </button>
              </section>

              {/* Actions */}
              <section className="pt-4 border-t border-current/10 space-y-2">
                <button
                  onClick={() => { if (confirm('恢复默认设置？')) resetSettings() }}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs opacity-60 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5"
                >
                  <RotateCcw size={12} /> 恢复默认
                </button>
                <button
                  onClick={() => { if (confirm(`清空 ${messages.length} 条聊天？这不能撤销。`)) clearMessages() }}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs text-red-500/80 hover:text-red-500 hover:bg-red-500/5"
                >
                  <Trash2 size={12} /> 清空对话（{messages.length} 条）
                </button>
              </section>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
