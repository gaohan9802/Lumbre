import { appendChatUpstreamError } from '@/server/data/log'
import { assertPublicHttpUrl } from '@/server/agent/tools/web-fetch'
import type { GatewayProvider } from './providers/types'

export class UpstreamHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'UpstreamHttpError'
  }
}

export function errorDetails(err: any) {
  const cause = err?.cause
  return {
    name: String(err?.name || ''), message: String(err?.message || err || 'unknown error'),
    causeName: String(cause?.name || ''), causeMessage: String(cause?.message || ''),
    causeCode: String(cause?.code || cause?.errno || ''),
  }
}

export function upstreamErrorMessage(status: number, text: string): string {
  if (status === 429) return '模型上游正在限流（429），通常是该渠道瞬时拥堵、额度/并发已满。系统已自动重试；仍失败请稍等，或切换到另一个 API 渠道/模型。'
  return `Upstream ${status}: ${text.slice(0, 800)}`
}

export function friendlyStreamError(err: any, hadOutput: boolean): string {
  const d = errorDetails(err)
  const raw = `${d.name} ${d.message} ${d.causeName} ${d.causeMessage} ${d.causeCode}`.toLowerCase()
  if (/terminated|socket|other side closed|econnreset|und_err_socket|premature close|aborted/.test(raw)) {
    return hadOutput ? '上游模型连接中途断开了，前面已收到的内容已保留。通常是模型中转站临时断流、长思考/长回复或多轮工具调用导致；可以直接点重 Roll。' : '上游模型连接在返回内容前断开了。通常是模型中转站临时断流或当前渠道不稳定，请重试；若连续出现，换同模型的另一个渠道。'
  }
  if (/timeout|timed out|etimedout/.test(raw)) return hadOutput ? '上游模型响应超时，前面已收到的内容已保留。可以点重 Roll，或临时降低思考预算。' : '上游模型响应超时了。请重试，或临时降低思考预算/缩短上下文。'
  if (/fetch failed|enotfound|eai_again|connect/.test(raw)) return 'Zeabur 暂时无法连接模型上游。请稍后重试；若连续出现，检查 API 渠道地址或换一个渠道。'
  return `上游模型流异常：${d.message || '未知连接错误'}`
}

export function logUpstreamStreamError(meta: { provider: GatewayProvider; model: string; baseUrl: string; iteration: number; hadOutput: boolean; toolCallCount: number; error: any }) {
  let upstreamOrigin = '(invalid base URL)'
  try { upstreamOrigin = new URL(meta.baseUrl).origin } catch {}
  const line = JSON.stringify({ at: new Date().toISOString(), provider: meta.provider, model: meta.model, upstreamOrigin, iteration: meta.iteration, hadOutput: meta.hadOutput, toolCallCount: meta.toolCallCount, ...errorDetails(meta.error) }) + '\n'
  if (!appendChatUpstreamError(line)) console.error('[chat upstream stream error]', line.trim())
}

export async function fetchUpstreamWithRetry(url: string, init: RequestInit, meta: { provider: GatewayProvider; model: string }) {
  await assertPublicHttpUrl(url)
  const maxAttempts = 3
  let last: Response | undefined
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    let res: Response
    try {
      const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal
      res = await fetch(url, { ...init, redirect: 'error', signal })
    } finally { clearTimeout(timeout) }
    if (res.status !== 429 || attempt === maxAttempts - 1) return res
    last = res
    const retryAfterSeconds = Number(res.headers.get('retry-after') || '')
    const headerDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 0
    const delay = Math.min(8000, Math.max(700 * (attempt + 1), headerDelay)) + Math.floor(Math.random() * 350)
    try { await res.arrayBuffer() } catch {}
    console.warn(`[chat upstream 429] provider=${meta.provider} model=${meta.model} attempt=${attempt + 1}/${maxAttempts} retry_ms=${delay}`)
    await new Promise(resolve => setTimeout(resolve, delay))
  }
  return last!
}

export async function assertUpstreamOk(response: Response): Promise<void> {
  if (response.ok) return
  throw new UpstreamHttpError(response.status, upstreamErrorMessage(response.status, await response.text()))
}
