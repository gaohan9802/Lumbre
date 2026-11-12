'use client'

import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ChatMessage, ChatSettings } from '@/features/chat/state/types'
import type { ReceiptMetric } from '@/lib/chat-receipt'
import { formatMadrid } from '@/lib/madrid-time'

type Prices = { input: number; output: number; cacheRead: number; cacheWrite: number }

function pricesFor(settings: ChatSettings, message: ChatMessage): Prices | null {
  if (message.route === 'claude-code' && /claude-fable-5-2/i.test(message.modelId || '')) {
    return { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 16 }
  }
  if (message.route === 'claude-code' && /claude-opus-5-5/i.test(message.modelId || '')) {
    return { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 8 }
  }
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
    <div aria-hidden="true" className={`receipt-ticket-rule my-4 ${night ? 'opacity-55' : ''}`} />
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
            className="receipt-modal-backdrop fixed inset-0 z-[78]" />
          <div className="fixed inset-0 z-[79] grid place-items-center px-4 pointer-events-none">
          <motion.section role="dialog" aria-modal="true" aria-labelledby="message-receipt-title"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className={`receipt-ticket relative pointer-events-auto w-full max-w-[410px] max-h-[88dvh] overflow-y-auto font-receipt ${night ? 'receipt-ticket-night todo-receipt-night' : ''}`}>
            <div className="px-6 pb-9 pt-9 sm:px-8">
              <header className="relative text-center">
                <h3 id="message-receipt-title" className="text-[22px] font-bold tracking-[0.16em]">LUMBRE</h3>
                <p className="receipt-ticket-accent mt-1 text-[10px] font-bold tracking-[0.24em]">USAGE DETAIL</p>
              </header>

              <ReceiptDivider night={night} />

              <div className="text-[11px] flex justify-between gap-3 opacity-65">
                <span>MESSAGE #{String(message.id).slice(-8)}</span>
                <time>{formatMadrid(message.timestamp)}</time>
              </div>

              <dl className="receipt-ticket-section mt-3 py-3 text-[12px] space-y-1.5">
                <div className="receipt-ticket-row flex justify-between gap-2"><dt>供应商</dt><dd className="text-right">{provider}</dd></div>
                <div className="receipt-ticket-row flex justify-between gap-2"><dt>模型</dt><dd className="text-right break-all">{message.modelId || '—'}</dd></div>
              </dl>

              <section className="relative pt-4">
                <p className="receipt-ticket-accent relative z-10 mb-3 text-center text-[10px] font-bold tracking-[0.18em]">本轮真实用量</p>
                <div className="receipt-ticket-stamp pointer-events-none absolute right-2 top-14 z-0 grid h-[76px] w-[76px] -rotate-6 place-content-center rounded-[42%] border-[3px] text-center opacity-50 outline outline-1 outline-offset-[-6px]">
                  <span className="text-[9px] tracking-[0.12em]">CACHE HIT</span>
                  <strong className="mt-1 text-lg leading-none">{hitRate.toFixed(1)}%</strong>
                </div>
                <dl className="relative z-10 text-[12px] space-y-1.5">
                  {[
                    ['输入 Tokens', input], ['输出 Tokens', output], ['缓存读取', cacheRead], ['缓存写入', cacheWrite],
                  ].map(([label, value]) => <div key={String(label)} className="receipt-ticket-row flex justify-between gap-2"><dt>{label}</dt><dd>{Number(value).toLocaleString()}</dd></div>)}
                </dl>
              </section>

              <ReceiptDivider night={night} />

              <section>
                <p className="receipt-ticket-accent mb-2 text-[10px] font-bold tracking-[0.18em]">请求内容审计 · 实际载荷</p>
                <dl className="text-[12px] space-y-1.5">
                  {rows.map(([label, metric]) => <div key={label} className={`receipt-ticket-row relative flex justify-between gap-2 ${label === '内容总长度' ? 'receipt-ticket-section mt-2 border-b-0 pt-2 font-semibold' : ''}`}>
                    <dt className="relative z-10">{label}</dt><dd className="relative z-10 text-right">{metricText(metric)}</dd>
                    {label === '内容总长度' && <svg aria-hidden="true" viewBox="0 0 92 82" className={`pointer-events-none absolute -right-1 -top-11 z-0 h-[82px] w-[92px] -rotate-6 opacity-[0.16] mix-blend-multiply ${night ? 'text-[#c79890]' : 'text-[#a73a32]'}`}>
                      <defs>
                        <filter id="receipt-paw-ink" x="-15%" y="-15%" width="130%" height="130%"><feTurbulence type="fractalNoise" baseFrequency="0.1" numOctaves="4" seed="7" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="3.6"/></filter>
                        <mask id="receipt-paw-wear"><rect width="92" height="82" fill="white"/><path d="m13 57 21-8m-24 15 28-7m7-12 21 7m-18 7 26 6M26 13l12 4m14-7 14 6M4 34l15 3m54-6 15 4M27 70l39-9m-29 14 22-5" stroke="black" strokeWidth="3.1" strokeLinecap="round" opacity=".9"/></mask>
                      </defs>
                      <g fill="currentColor" filter="url(#receipt-paw-ink)" mask="url(#receipt-paw-wear)">
                        <path d="M13 73c-5-10 2-24 12-32 7-6 13-10 21-10 9 0 16 5 23 12 10 9 14 22 7 30-7 7-18 1-30 1-13 0-26 7-33-1Z"/>
                        <ellipse cx="11" cy="33" rx="9" ry="14" transform="rotate(-25 11 33)"/>
                        <ellipse cx="32" cy="15" rx="10" ry="15" transform="rotate(-9 32 15)"/>
                        <ellipse cx="59" cy="15" rx="10" ry="15" transform="rotate(9 59 15)"/>
                        <ellipse cx="81" cy="33" rx="9" ry="14" transform="rotate(25 81 33)"/>
                      </g>
                    </svg>}
                  </div>)}
                </dl>
                {!audit && <p className="mt-3 text-[10px] opacity-45">旧消息未留存内容快照；新回复会自动记录。</p>}
              </section>

              <details className="receipt-ticket-section mt-4 py-3 text-[11px]">
                <summary className="cursor-pointer select-none">逐项明细 · 展开</summary>
                <div className="mt-2 space-y-1 opacity-55">
                  <p>线路：{message.route === 'claude-code' ? 'Claude Code' : 'API'}</p>
                  {message.ccSessionFingerprint && <p>CC session：{message.ccSessionFingerprint} · {message.ccSessionMode || 'resume'}{message.ccSessionReason ? ` · ${message.ccSessionReason}` : ''}</p>}
                  <p>命中率 = 缓存读取 ÷（普通输入 + 缓存读取 + 缓存写入）</p>
                </div>
              </details>

            </div>
          </motion.section>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
