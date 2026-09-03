import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_REDIRECTS = 3
const MAX_RESPONSE_BYTES = 512 * 1024
const OUTPUT_CAP = 6000
const FETCH_TIMEOUT_MS = 12_000
const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
])

type LookupAddress = { address: string; family: number }
type LookupFn = (hostname: string) => Promise<LookupAddress[]>

function ipv4Number(address: string): number | null {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0
}

function inV4Range(value: number, base: string, prefix: number): boolean {
  const baseValue = ipv4Number(base)!
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (value & mask) === (baseValue & mask)
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('fc') || normalized.startsWith('fd') || /^fe[89ab]/.test(normalized) || normalized.startsWith('ff') || normalized.startsWith('2001:db8:')) return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized)
  const mappedHexV4 = mappedHex
    ? `${parseInt(mappedHex[1], 16) >> 8}.${parseInt(mappedHex[1], 16) & 255}.${parseInt(mappedHex[2], 16) >> 8}.${parseInt(mappedHex[2], 16) & 255}`
    : ''
  const v4 = ipv4Number(mapped?.[1] || mappedHexV4 || normalized)
  if (v4 == null) return false
  return [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
    ['224.0.0.0', 4],
  ].some(([base, prefix]) => inV4Range(v4, base as string, prefix as number))
}

const defaultLookup: LookupFn = async hostname => {
  const result = await lookup(hostname, { all: true, verbatim: true })
  return result.map(item => ({ address: item.address, family: item.family }))
}

export async function assertPublicHttpUrl(raw: string, lookupFn: LookupFn = defaultLookup): Promise<URL> {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error('URL 格式无效') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只允许 http 和 https 协议')
  if (url.username || url.password) throw new Error('URL 不允许包含用户名或密码')
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '')
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('目标地址不允许访问')
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookupFn(hostname)
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('目标解析到本机、内网或保留地址')
  }
  return url
}

function safeHeaders(headers?: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = { 'User-Agent': 'Mozilla/5.0 (Lumbre)' }
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase()
    if (!['accept', 'accept-language'].includes(lower)) continue
    if (typeof value === 'string' && value.length <= 500) result[key] = value
  }
  return result
}

async function readBoundedBody(response: Response): Promise<string> {
  const length = Number(response.headers.get('content-length') || 0)
  if (length > MAX_RESPONSE_BYTES) throw new Error('响应体超过 512KB 限制')
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      try { await reader.cancel() } catch {}
      throw new Error('响应体超过 512KB 限制')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(bytes)
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|br|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

function htmlToMarkdown(html: string): string {
  let value = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
  value = value.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_match, level, text) => `\n${'#'.repeat(Number(level))} ${text.replace(/<[^>]+>/g, '').trim()}\n`)
  value = value.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi, (_match, href, text) => `[${text.replace(/<[^>]+>/g, '').trim()}](${href})`)
  value = value.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, text) => `- ${text.replace(/<[^>]+>/g, '').trim()}\n`)
  value = value.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, (_match, _tag, text) => `**${text.replace(/<[^>]+>/g, '').trim()}**`)
  return htmlToText(value)
}

export async function executeSafeFetch(tool: string, rawUrl: string, headers?: Record<string, string>): Promise<string> {
  if (!rawUrl) return '请提供合法的 http(s) URL'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    let url = await assertPublicHttpUrl(rawUrl)
    let response: Response | undefined
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      response = await fetch(url, { headers: safeHeaders(headers), signal: controller.signal, redirect: 'manual' })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get('location')
      if (!location) break
      if (redirect === MAX_REDIRECTS) throw new Error('重定向次数超过限制')
      try { await response.body?.cancel() } catch {}
      url = await assertPublicHttpUrl(new URL(location, url).toString())
    }
    if (!response) throw new Error('没有收到响应')
    const raw = await readBoundedBody(response)
    let output: string
    if (tool === 'fetch_json') {
      try { output = JSON.stringify(JSON.parse(raw)) } catch { return `HTTP ${response.status}: 返回的不是合法 JSON` }
    } else if (tool === 'fetch_txt') output = htmlToText(raw)
    else if (tool === 'fetch_markdown') output = htmlToMarkdown(raw)
    else output = raw
    const result = `HTTP ${response.status} · ${url.toString()}\n\n${output}`
    return result.length > OUTPUT_CAP ? `${result.slice(0, OUTPUT_CAP)}\n…(truncated)` : result
  } catch (error: any) {
    return `Fetch error: ${error?.name === 'AbortError' ? '请求超时' : error?.message || String(error)}`
  } finally {
    clearTimeout(timer)
  }
}
