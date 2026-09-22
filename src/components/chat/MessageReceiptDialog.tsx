'use client'

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import type { ChatMessage, ChatSettings } from '@/features/chat/state/types'
import type { ReceiptMetric } from '@/lib/chat-receipt'
import { formatMadrid } from '@/lib/madrid-time'

type Prices = { input: number; output: number; cacheRead: number; cacheWrite: number }

function pricesFor(settings: ChatSettings, message: ChatMessage): Prices | null {
  if (message.route === 'claude-code' && /claude-opus-4-6/i.test(message.modelId || '')) {
    return { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 10 }
  }
  const profile = settings.apiProfiles.find(item => item.id === message.providerId)
  const model = profile?.models.find(item => item.id === message.modelId)
  if (!model || !model.inputPrice || !model.outputPrice) return null
  return {
    input: model.inputPrice,
    output: model.outputPrice,
    cacheRead: model.cachePrice || model.inputPrice,
    cacheWrite: profile?.provider === 'anthropic' ? model.inputPrice * 1.25 : model.inputPrice,
  }
}

export function estimateListPrice(settings: ChatSettings, message: ChatMessage) {
  const prices = pricesFor(settings, message)
  if (!prices) return null
  return (
    (message.input_tokens || 0) * prices.input
    + (message.output_tokens || 0) * prices.output
    + (message.cache_read_tokens || 0) * prices.cacheRead
    + (message.cache_creation_tokens || 0) * prices.cacheWrite
  ) / 1_000_000
}

function metricText(metric?: ReceiptMetric) {
  return metric ? `${metric.chars.toLocaleString()} 字符 · ${metric.bytes.toLocaleString()} B` : '—'
}

function ReceiptDivider({ night }: { night: boolean }) {
  return (
    <div aria-hidden="true" className={`my-4 flex items-center gap-2 ${night ? 'text-[#bda47c]' : 'text-[#a73a32]'}`}>
      <span className="h-px flex-1 bg-current/45" />
      <svg viewBox="0 0 36 16" className="h-4 w-9" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M1 13C10 12 17 8 24 2M12 10C10 5 7 4 4 5M20 5c4 0 7 2 9 6M24 2c3 1 5 0 7-2" />
        <path d="M5 5c1 3 3 4 7 5M29 11c-3-1-5-3-5-6" fill="currentColor" stroke="none" />
      </svg>
      <span className="h-px flex-1 bg-current/45" />
    </div>
  )
}

export function MessageReceiptDialog({
  message,
  settings,
  night,
  onClose,
}: {
  message: ChatMessage | null
  settings: ChatSettings
  night: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (!message) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [message, onClose])

  const profile = settings.apiProfiles.find(item => item.id === message?.providerId)
  const provider = message?.route === 'claude-code'
    ? 'Anthropic'
    : profile?.provider === 'anthropic' ? 'Anthropic' : profile?.name || 'OpenAI-compatible'
  const input = message?.input_tokens || 0
  const output = message?.output_tokens || 0
  const cacheRead = message?.cache_read_tokens || 0
  const cacheWrite = message?.cache_creation_tokens || 0
  const cacheBase = input + cacheRead + cacheWrite
  const hitRate = cacheBase ? (cacheRead / cacheBase) * 100 : 0
  const audit = message?.request_audit
  const rows: [string, ReceiptMetric | undefined][] = [
    ['固定人格', audit?.persona],
    ['随身摘要', audit?.summary],
    ['历史消息', audit?.history],
    ['工具结果', audit?.toolResults],
    ['工具定义', audit?.toolDefinitions],
    ['其他', audit?.currentContext],
    ['内容总长度', audit?.total],
  ]

  return (
    <AnimatePresence>
      {message && (
        <>
          <motion.button type="button" aria-label="关闭上下文小票" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
            className="fixed inset-0 z-[78] bg-black/35 backdrop-blur-[2px]" />
          <div className="fixed inset-0 z-[79] grid place-items-center px-4 pointer-events-none">
          <motion.section role="dialog" aria-modal="true" aria-labelledby="message-receipt-title"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className={`relative pointer-events-auto w-full max-w-[410px] max-h-[88dvh] overflow-y-auto border font-mono shadow-[0_18px_50px_rgba(49,29,23,0.2)] ${night ? 'bg-[#24221f] text-[#eee6d6] border-[#857b6c]' : 'chat-paper bg-[#faf7f0] text-[#4b332e] border-[#a73a32]/35'}`}>
            <div className={`h-2 opacity-55 ${night ? '' : 'text-[#a73a32]'}`} style={{ backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 5px, transparent 5px 10px)' }} />
            <div aria-hidden="true" className={`absolute left-1/2 top-3.5 z-10 h-4 w-4 -translate-x-1/2 rounded-full border shadow-inner ${night ? 'border-[#8b7044] bg-[#b18a48]' : 'border-[#8b641b] bg-[#c7932d]'}`}>
              <span className="absolute inset-[3px] rounded-full border border-white/30" />
            </div>
            <button type="button" onClick={onClose} aria-label="关闭" className={`absolute right-3 top-4 z-10 p-1 opacity-55 hover:opacity-100 ${night ? '' : 'text-[#a73a32]'}`}><X size={17} /></button>
            <div className="px-6 pb-8 pt-9 sm:px-8">
              <header className="relative text-center">
                <h3 id="message-receipt-title" className="font-serif text-xl font-semibold tracking-[0.2em]">LUMBRE</h3>
                <p className={`mt-1 text-[10px] tracking-[0.28em] ${night ? 'opacity-55' : 'text-[#a73a32]/70'}`}>USAGE DETAIL</p>
              </header>

              <ReceiptDivider night={night} />

              <div className="text-[11px] flex justify-between gap-3 opacity-65">
                <span>MESSAGE #{String(message.id).slice(-8)}</span>
                <time>{formatMadrid(message.timestamp)}</time>
              </div>

              <dl className={`mt-3 border-y py-3 text-[12px] space-y-1.5 ${night ? 'border-current/20' : 'border-[#a73a32]/25'}`}>
                <div className="flex justify-between gap-4"><dt>供应商</dt><dd className="text-right">{provider}</dd></div>
                <div className="flex justify-between gap-4"><dt>模型</dt><dd className="text-right break-all">{message.modelId || '—'}</dd></div>
              </dl>

              <section className="relative pt-4">
                <p className={`mb-3 text-center text-[10px] tracking-[0.18em] ${night ? 'opacity-45' : 'text-[#a73a32]/65'}`}>本轮真实用量</p>
                <div className={`pointer-events-none absolute right-2 top-8 z-10 grid h-[76px] w-[76px] -rotate-6 place-content-center rounded-full border-2 text-center opacity-75 ${night ? 'border-[#b18a48] text-[#d8b66c]' : 'border-[#b18329] text-[#9c711b]'}`}>
                  <span className="text-[9px] tracking-[0.12em]">CACHE HIT</span>
                  <strong className="mt-1 font-serif text-lg leading-none">{hitRate.toFixed(1)}%</strong>
                </div>
                <dl className="relative text-[12px] space-y-1.5">
                  {[
                    ['输入 Tokens', input], ['输出 Tokens', output], ['缓存读取', cacheRead], ['缓存写入', cacheWrite],
                  ].map(([label, value]) => <div key={String(label)} className="flex justify-between gap-4"><dt>{label}</dt><dd>{Number(value).toLocaleString()}</dd></div>)}
                </dl>
              </section>

              <ReceiptDivider night={night} />

              <section>
                <p className={`mb-2 text-[10px] tracking-[0.18em] ${night ? 'opacity-45' : 'text-[#a73a32]/65'}`}>请求内容审计 · 实际载荷</p>
                <dl className="text-[12px] space-y-1.5">
                  {rows.map(([label, metric]) => <div key={label} className={`relative flex justify-between gap-4 ${label === '内容总长度' ? `mt-2 border-t pt-2 font-semibold ${night ? 'border-current/20' : 'border-[#a73a32]/25'}` : ''}`}>
                    <dt>{label}</dt><dd className="text-right">{metricText(metric)}</dd>
                    {label === '内容总长度' && <svg aria-hidden="true" viewBox="0 0 72 58" className={`pointer-events-none absolute -right-1 -top-7 z-10 h-[62px] w-[76px] -rotate-12 opacity-60 mix-blend-multiply ${night ? 'text-[#bda47c]' : 'text-[#a73a32]'}`}>
                      <defs><filter id="receipt-paw-ink" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency="0.09" numOctaves="2" seed="7" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="1.8"/></filter></defs>
                      <g fill="currentColor" filter="url(#receipt-paw-ink)">
                        <path d="M21 51c-5-5-3-14 2-19 4-4 7-7 13-7s10 3 13 7c5 6 7 14 2 19-4 4-9 1-15 1s-11 3-15-1Z"/>
                        <ellipse cx="10" cy="27" rx="7" ry="9" transform="rotate(-25 10 27)"/>
                        <ellipse cx="23" cy="13" rx="7" ry="10" transform="rotate(-10 23 13)"/>
                        <ellipse cx="41" cy="12" rx="7" ry="10" transform="rotate(9 41 12)"/>
                        <ellipse cx="58" cy="25" rx="7" ry="9" transform="rotate(24 58 25)"/>
                      </g>
                      <g fill="none" stroke="currentColor" strokeWidth="1" opacity=".35"><path d="M24 49c8-4 18-4 25 0"/><path d="M8 24c2 4 4 6 7 7M21 9c1 5 3 8 6 10M40 8c0 5-1 8-4 11M57 22c-2 4-4 6-7 8"/></g>
                    </svg>}
                  </div>)}
                </dl>
                {!audit && <p className="mt-3 text-[10px] opacity-45">旧消息未留存内容快照；新回复会自动记录。</p>}
              </section>

              <details className={`mt-4 border-y py-3 text-[11px] ${night ? 'border-current/20' : 'border-[#a73a32]/25'}`}>
                <summary className="cursor-pointer select-none">逐项明细 · 展开</summary>
                <div className="mt-2 space-y-1 opacity-55">
                  <p>线路：{message.route === 'claude-code' ? 'Claude Code' : 'API'}</p>
                  {message.ccSessionFingerprint && <p>CC session：{message.ccSessionFingerprint} · {message.ccSessionMode || 'resume'}{message.ccSessionReason ? ` · ${message.ccSessionReason}` : ''}</p>}
                  <p>命中率 = 缓存读取 ÷（普通输入 + 缓存读取 + 缓存写入）</p>
                </div>
              </details>

            </div>
            <div className={`h-2 opacity-55 ${night ? '' : 'text-[#a73a32]'}`} style={{ backgroundImage: 'repeating-linear-gradient(45deg, currentColor 0 5px, transparent 5px 10px)' }} />
          </motion.section>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
