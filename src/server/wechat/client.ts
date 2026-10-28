import { createDecipheriv, randomBytes, randomUUID } from 'node:crypto'

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com'
const DEFAULT_CDN_URL = 'https://novac2c.cdn.weixin.qq.com/c2c'
const CHANNEL_VERSION = '2.4.10'
const CLIENT_VERSION = process.env.LUMBRE_WECHAT_CLIENT_VERSION || '132106'
const MAX_MEDIA_BYTES = 10 * 1024 * 1024

function trustedWeChatBaseUrl(value: unknown, fallback = DEFAULT_BASE_URL) {
  const raw = String(value || fallback).trim()
  const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`)
  const trustedHost = ['weixin.qq.com', 'wechat.com'].some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))
  if (parsed.protocol !== 'https:' || !trustedHost) throw new Error('微信接口地址不受信任')
  return `${parsed.origin}${parsed.pathname.replace(/\/+$/, '')}`
}

export interface WeChatAccount {
  botToken: string
  accountId: string
  baseUrl: string
  userId: string
}

export interface WeChatMessageItem {
  type?: number
  text_item?: { text?: string }
  image_item?: {
    aeskey?: string
    media?: { encrypt_query_param?: string; aes_key?: string; full_url?: string }
  }
}

export interface WeChatInboundMessage {
  message_id?: string | number
  from_user_id?: string
  to_user_id?: string
  create_time_ms?: number
  message_type?: number
  item_list?: WeChatMessageItem[]
  context_token?: string
}

function uin() {
  return Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64')
}

function appHeaders(json = false) {
  return {
    ...(json ? { 'Content-Type': 'application/json', AuthorizationType: 'ilink_bot_token', 'X-WECHAT-UIN': uin() } : {}),
    'iLink-App-Id': 'bot',
    'iLink-App-ClientVersion': CLIENT_VERSION,
  }
}

function baseInfo() {
  return { channel_version: CHANNEL_VERSION, bot_agent: 'Lumbre/1.0' }
}

async function jsonFetch<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
    if (!response.ok) throw new Error(`微信接口返回 ${response.status}`)
    return await response.json() as T
  } finally { clearTimeout(timer) }
}

export async function startWeChatQrLogin() {
  const data = await jsonFetch<any>(`${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`, {
    method: 'POST', headers: appHeaders(true), body: JSON.stringify({ local_token_list: [] }),
  }, 20_000)
  if (!data?.qrcode || !data?.qrcode_img_content) throw new Error(data?.errmsg || '没有拿到微信二维码')
  return { qrcodeId: String(data.qrcode), qrcodeUrl: String(data.qrcode_img_content) }
}

export async function pollWeChatQrLogin(qrcodeId: string, pollBaseUrl?: string, verifyCode?: string) {
  const baseUrl = trustedWeChatBaseUrl(pollBaseUrl)
  const query = new URLSearchParams({ qrcode: qrcodeId })
  if (verifyCode?.trim()) query.set('verify_code', verifyCode.trim())
  const data = await jsonFetch<any>(`${baseUrl}/ilink/bot/get_qrcode_status?${query}`, {
    method: 'GET', headers: appHeaders(false),
  }, 65_000)
  const status = String(data?.status || 'wait')
  const redirected = data?.redirect_host ? trustedWeChatBaseUrl(data.redirect_host, baseUrl) : undefined
  if (status !== 'confirmed') return { status, message: String(data?.retmsg || ''), pollBaseUrl: redirected || baseUrl }
  if (!data.bot_token || !data.ilink_bot_id || !data.ilink_user_id) throw new Error('微信确认成功，但凭据不完整')
  return {
    status: 'confirmed',
    account: {
      botToken: String(data.bot_token), accountId: String(data.ilink_bot_id),
      userId: String(data.ilink_user_id), baseUrl: trustedWeChatBaseUrl(data.baseurl),
    } satisfies WeChatAccount,
  }
}

export class WeChatClient {
  private nextSendAt = 0
  constructor(private readonly account: WeChatAccount) {}

  private headers() {
    return {
      ...appHeaders(true),
      Authorization: `Bearer ${this.account.botToken}`,
    }
  }

  private async post<T>(path: string, body: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
    const baseUrl = trustedWeChatBaseUrl(this.account.baseUrl)
    return jsonFetch<T>(`${baseUrl}/${path}`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify({ ...body, base_info: baseInfo() }),
    }, timeoutMs)
  }

  getUpdates(cursor: string) {
    return this.post<{ ret?: number; errcode?: number; errmsg?: string; msgs?: WeChatInboundMessage[]; get_updates_buf?: string }>(
      'ilink/bot/getupdates', { get_updates_buf: cursor }, 45_000,
    )
  }

  notifyStart() {
    return this.post<{ ret?: number; errmsg?: string }>('ilink/bot/msg/notifystart', {}, 10_000)
  }

  notifyStop() {
    return this.post<{ ret?: number; errmsg?: string }>('ilink/bot/msg/notifystop', {}, 10_000)
  }

  async sendTyping(userId: string, contextToken: string, status: 1 | 2) {
    const config = await this.post<{ typing_ticket?: string }>('ilink/bot/getconfig', {
      ilink_user_id: userId, context_token: contextToken,
    }, 10_000)
    if (!config.typing_ticket) return
    await this.post('ilink/bot/sendtyping', { ilink_user_id: userId, typing_ticket: config.typing_ticket, status }, 10_000)
  }

  async sendText(userId: string, contextToken: string, text: string) {
    const chunks = text.trim().match(/[\s\S]{1,600}/g) || ['…']
    for (const chunk of chunks.slice(0, 3)) {
      const waitMs = Math.max(0, this.nextSendAt - Date.now())
      if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs))
      this.nextSendAt = Date.now() + 2_500
      const result = await this.post<{ ret?: number; errmsg?: string }>('ilink/bot/sendmessage', { msg: {
        from_user_id: '',
        to_user_id: userId,
        client_id: randomUUID(),
        message_type: 2,
        message_state: 2,
        context_token: contextToken,
        item_list: [{ type: 1, text_item: { text: chunk } }],
      } })
      if (result.ret != null && result.ret !== 0) throw new Error(result.errmsg || `微信发送失败 (${result.ret})`)
    }
  }
}

function keyBytes(value: string): Buffer | null {
  if (/^[a-f0-9]{32}$/i.test(value)) return Buffer.from(value, 'hex')
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length === 16) return decoded
  const hex = decoded.toString('utf8')
  return /^[a-f0-9]{32}$/i.test(hex) ? Buffer.from(hex, 'hex') : null
}

function imageMime(bytes: Buffer) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif'
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF') return 'image/webp'
  return 'image/jpeg'
}

export async function downloadWeChatImage(item: WeChatMessageItem): Promise<string | null> {
  const image = item.image_item
  const media = image?.media
  const query = media?.encrypt_query_param
  const key = keyBytes(image?.aeskey || media?.aes_key || '')
  if (!image || !query || !key) return null
  const fullUrl = media?.full_url
  const url = fullUrl || `${DEFAULT_CDN_URL}/download?encrypted_query_param=${encodeURIComponent(query)}`
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !['weixin.qq.com', 'wechat.com'].some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) {
    throw new Error('微信图片地址不受信任')
  }
  const response = await fetch(parsed, { cache: 'no-store' })
  if (!response.ok) throw new Error(`微信图片下载失败 (${response.status})`)
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_MEDIA_BYTES) throw new Error('微信图片超过 10 MB')
  const encrypted = Buffer.from(await response.arrayBuffer())
  if (encrypted.length > MAX_MEDIA_BYTES) throw new Error('微信图片超过 10 MB')
  const decipher = createDecipheriv('aes-128-ecb', key, null)
  const bytes = Buffer.concat([decipher.update(encrypted), decipher.final()])
  return `data:${imageMime(bytes)};base64,${bytes.toString('base64')}`
}
