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
    ? 'Anthropic · First-party'
    : `${profile?.name || '未知渠道'} · ${profile?.provider === 'anthropic' ? 'Anthropic' : 'OpenAI-compatible'}`
  const input = message?.input_tokens || 0
  const output = message?.output_tokens || 0
  const cacheRead = message?.cache_read_tokens || 0
  const cacheWrite = message?.cache_creation_tokens || 0
  const cacheBase = input + cacheRead + cacheWrite
  const hitRate = cacheBase ? (cacheRead / cacheBase) * 100 : 0
  const estimate = message ? estimateListPrice(settings, message) : null
  const audit = message?.request_audit
  const rows: [string, ReceiptMetric | undefined][] = [
    ['固定人格', audit?.persona],
    ['随身摘要', audit?.summary],
    ['历史消息', audit?.history],
    ['工具结果', audit?.toolResults],
    ['工具定义', audit?.toolDefinitions],
    ['时间 / Pulse / 纸条', audit?.currentContext],
    ['内容总长度', audit?.total],
  ]

  return (
    <AnimatePresence>
      {message && (
        <>
          <motion.button type="button" aria-label="关闭上下文小票" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
            className="fixed inset-0 z-[78] bg-black/45 backdrop-blur-sm" />
          <div className="fixed inset-0 z-[79] grid place-items-center px-4 pointer-events-none">
          <motion.section role="dialog" aria-modal="true" aria-labelledby="message-receipt-title"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className={`relative pointer-events-auto w-full max-w-[430px] max-h-[88dvh] overflow-y-auto border shadow-2xl font-mono ${night ? 'bg-[#24221f] text-[#eee6d6] border-[#857b6c]' : 'bg-[#f7f0df] text-[#26353a] border-[#c9bda5]'}`}>
            <div className="h-2 opacity-40" style={{ backgroundImage: 'repeating-linear-gradient(135deg, currentColor 0 6px, transparent 6px 12px)' }} />
            <button type="button" onClick={onClose} aria-label="关闭" className="absolute right-3 top-4 p-1 opacity-50 hover:opacity-100"><X size={17} /></button>
            <div className="px-6 py-7 sm:px-8">
              <header className="text-center">
                <h3 id="message-receipt-title" className="font-serif text-xl font-semibold tracking-[0.2em]">LUMBRE</h3>
                <p className="mt-1 text-[11px] tracking-[0.28em] opacity-55">CONTEXT RECEIPT</p>
              </header>

              <div className="mt-5 border-y border-dashed border-current/25 py-3 text-[11px] flex justify-between gap-3">
                <span>MESSAGE #{String(message.id).slice(-8)}</span>
                <time>{formatMadrid(message.timestamp)}</time>
              </div>

              <dl className="py-4 border-b border-dashed border-current/25 text-[12px] space-y-1.5">
                <div className="flex justify-between gap-4"><dt>供应商</dt><dd className="text-right">{provider}</dd></div>
                <div className="flex justify-between gap-4"><dt>模型</dt><dd className="text-right break-all">{message.modelId || '—'}</dd></div>
              </dl>

              <section className="py-4 border-b border-dashed border-current/25">
                <p className="mb-2 text-[10px] tracking-[0.18em] opacity-45">本轮真实用量</p>
                <dl className="text-[12px] space-y-1.5">
                  {[
                    ['输入 Tokens', input], ['输出 Tokens', output], ['缓存读取', cacheRead], ['缓存写入', cacheWrite],
                  ].map(([label, value]) => <div key={String(label)} className="flex justify-between"><dt>{label}</dt><dd>{Number(value).toLocaleString()}</dd></div>)}
                  <div className="flex justify-between font-semibold"><dt>缓存命中率</dt><dd>{hitRate.toFixed(1)}%</dd></div>
                </dl>
              </section>

              <section className="py-4 border-b border-dashed border-current/25">
                <p className="mb-2 text-[10px] tracking-[0.18em] opacity-45">请求内容审计 · 实际载荷</p>
                <dl className="text-[12px] space-y-1.5">
                  {rows.map(([label, metric]) => <div key={label} className={`flex justify-between gap-4 ${label === '内容总长度' ? 'pt-1 font-semibold' : ''}`}><dt>{label}</dt><dd className="text-right">{metricText(metric)}</dd></div>)}
                </dl>
                {!audit && <p className="mt-3 text-[10px] opacity-45">旧消息未留存内容快照；新回复会自动记录。</p>}
                <p className="mt-3 text-[10px] leading-relaxed opacity-45">字符与 UTF-8 字节来自本轮 Lumbre 内容快照；协议包装由供应商处理，token 以上方返回值为准。</p>
              </section>

              <details className="py-3 border-b border-dashed border-current/25 text-[11px]">
                <summary className="cursor-pointer select-none">逐项明细 · 展开</summary>
                <div className="mt-2 space-y-1 opacity-55">
                  <p>线路：{message.route === 'claude-code' ? 'Claude Code' : 'API'}</p>
                  {message.ccSessionFingerprint && <p>CC session：{message.ccSessionFingerprint} · {message.ccSessionMode || 'resume'}</p>}
                  <p>命中率 = 缓存读取 ÷（普通输入 + 缓存读取 + 缓存写入）</p>
                </div>
              </details>

              <div className="pt-4 flex justify-between text-[13px]">
                <span>官方标价估值</span>
                <strong>{estimate == null ? '未配置' : `$${estimate.toFixed(6)}`}</strong>
              </div>
              {message.route === 'claude-code' && <p className="mt-2 text-[10px] opacity-45">按 Anthropic API 的一小时缓存公开标价折算；CC 订阅不按此金额扣费。</p>}

              <div className="mt-7 text-center">
                <p className="font-serif text-base tracking-[0.12em]">让每一次命中，都有迹可循。</p>
                <div aria-hidden="true" className="mx-auto mt-3 h-8 w-40 opacity-55" style={{ backgroundImage: 'repeating-linear-gradient(90deg,currentColor 0 2px,transparent 2px 5px,currentColor 5px 6px,transparent 6px 10px)' }} />
              </div>
            </div>
            <div className="h-2 opacity-40" style={{ backgroundImage: 'repeating-linear-gradient(45deg, currentColor 0 6px, transparent 6px 12px)' }} />
          </motion.section>
          </div>
        </>
      )}
    </AnimatePresence>
  )
}
