import { createDecipheriv, createHash, timingSafeEqual } from 'node:crypto'
import { composeBubbleBlocks } from '@/lib/chat-bubble-composer'
import { loadSyncManifest } from '@/server/chat-sync'
import { getDataDir } from '@/server/data/config'
import { readJsonFile, writeJsonFile } from '@/server/data/json-file'
import { resolveDataPath } from '@/server/data/safe-path'
import { WeChatBatcher } from './batcher'
import { readWeChatConnection } from './store'
import { createWeChatBatchId, persistWeChatPart, runWeChatTurn, type WeChatTurnPart } from './turn'

type WeComConfig = {
  corpId: string
  agentId: number
  secret: string
  token: string
  aesKey: Buffer
}

type WeComMessage = {
  fromUserId: string
  messageId: string
  messageType: string
  text: string
  timestamp: number
}

type WeComState = {
  targetSessionId?: string
  lastMessageAt?: string
  lastError?: string
}

type PendingPart = WeChatTurnPart & { batchId: string; replyUserId: string }

const stateFile = resolveDataPath(getDataDir(), 'wecom', 'state.json')
let cachedToken: { key: string; value: string; expiresAt: number } | null = null

function config(): WeComConfig {
  const corpId = String(process.env.LUMBRE_WECOM_CORP_ID || '').trim()
  const agentIdRaw = String(process.env.LUMBRE_WECOM_AGENT_ID || '').trim()
  const secret = String(process.env.LUMBRE_WECOM_SECRET || '').trim()
  const token = String(process.env.LUMBRE_WECOM_CALLBACK_TOKEN || '').trim()
  const aesKeyRaw = String(process.env.LUMBRE_WECOM_CALLBACK_AES_KEY || '').trim()
  const aesKey = Buffer.from(`${aesKeyRaw}=`, 'base64')
  if (!corpId || !/^\d+$/.test(agentIdRaw) || !secret || !/^[A-Za-z0-9]{1,32}$/.test(token) || !/^[A-Za-z0-9]{43}$/.test(aesKeyRaw) || aesKey.length !== 32) {
    throw new Error('企业微信服务器凭据尚未配置完整')
  }
  return { corpId, agentId: Number(agentIdRaw), secret, token, aesKey }
}

function field(xml: string, name: string) {
  const match = new RegExp(`<${name}>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))</${name}>`).exec(xml)
  return String(match?.[1] ?? match?.[2] ?? '').trim()
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

function signature(token: string, timestamp: string, nonce: string, encrypted: string) {
  return createHash('sha1').update([token, timestamp, nonce, encrypted].sort().join('')).digest('hex')
}

function equalSignature(actual: string, expected: string) {
  const left = Buffer.from(actual)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

export function decodeWeComEnvelope(input: { signature: string; timestamp: string; nonce: string; encrypted: string }) {
  const current = config()
  if (!equalSignature(input.signature, signature(current.token, input.timestamp, input.nonce, input.encrypted))) {
    throw new Error('企业微信回调签名无效')
  }
  const decipher = createDecipheriv('aes-256-cbc', current.aesKey, current.aesKey.subarray(0, 16))
  decipher.setAutoPadding(false)
  const padded = Buffer.concat([decipher.update(input.encrypted, 'base64'), decipher.final()])
  const padding = padded.at(-1) || 0
  if (padding < 1 || padding > 32 || !padded.subarray(-padding).every(byte => byte === padding)) throw new Error('企业微信回调填充无效')
  const plain = padded.subarray(0, -padding)
  if (plain.length < 20) throw new Error('企业微信回调内容不完整')
  const length = plain.readUInt32BE(16)
  const end = 20 + length
  if (end > plain.length) throw new Error('企业微信回调长度无效')
  const receiveId = plain.subarray(end).toString('utf8')
  if (receiveId !== current.corpId) throw new Error('企业微信回调企业不匹配')
  return plain.subarray(20, end).toString('utf8')
}

export function parseWeComMessage(xml: string): WeComMessage | null {
  const messageType = field(xml, 'MsgType')
  const fromUserId = field(xml, 'FromUserName')
  if (!fromUserId || !messageType) return null
  const timestamp = Number(field(xml, 'CreateTime')) * 1_000 || Date.now()
  const messageId = field(xml, 'MsgId') || `${fromUserId}:${timestamp}`
  if (messageType !== 'text') return { fromUserId, messageId, messageType, text: '', timestamp }
  return { fromUserId, messageId, messageType, text: field(xml, 'Content'), timestamp }
}

function readState(): WeComState {
  try { return readJsonFile<WeComState>(stateFile) } catch { return {} }
}

function patchState(patch: Partial<WeComState>) {
  writeJsonFile(stateFile, { ...readState(), ...patch })
}

function targetSessionId() {
  const state = readState()
  const sessions = new Set(loadSyncManifest().sessions.map(session => session.id))
  if (state.targetSessionId && sessions.has(state.targetSessionId)) return state.targetSessionId
  const existing = readWeChatConnection()?.targetSessionId
  if (!existing || !sessions.has(existing)) throw new Error('企业微信还没有可绑定的 Lumbre 主窗')
  patchState({ targetSessionId: existing })
  return existing
}

async function accessToken(current: WeComConfig) {
  const key = `${current.corpId}:${current.agentId}`
  if (cachedToken?.key === key && cachedToken.expiresAt > Date.now()) return cachedToken.value
  const query = new URLSearchParams({ corpid: current.corpId, corpsecret: current.secret })
  const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?${query}`, { cache: 'no-store' })
  const body: any = await response.json()
  if (!response.ok || Number(body.errcode || 0) !== 0 || !body.access_token) throw new Error(body.errmsg || `企业微信令牌获取失败 (${response.status})`)
  cachedToken = { key, value: String(body.access_token), expiresAt: Date.now() + Math.max(60, Number(body.expires_in) - 120) * 1_000 }
  return cachedToken.value
}

export async function sendWeComText(userId: string, text: string) {
  const current = config()
  const token = await accessToken(current)
  const chunks = composeBubbleBlocks([{ type: 'text', content: text.trim() }]).blocks
    .flatMap(block => block.content?.match(/[\s\S]{1,600}/g) || [])
  for (const chunk of chunks.length ? chunks : ['…']) {
    const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ touser: userId, msgtype: 'text', agentid: current.agentId, text: { content: chunk }, safe: 0 }),
      cache: 'no-store',
    })
    const body: any = await response.json()
    if (!response.ok || Number(body.errcode || 0) !== 0) throw new Error(body.errmsg || `企业微信发送失败 (${response.status})`)
  }
}

const batcher = new WeChatBatcher<PendingPart>(async items => {
  const latest = items.at(-1)
  if (!latest) return
  try {
    const result = await runWeChatTurn(targetSessionId(), items[0].batchId, items.map(({ batchId: _batchId, replyUserId: _replyUserId, ...part }) => part))
    await sendWeComText(latest.replyUserId, result.text)
    patchState({ lastMessageAt: new Date().toISOString(), lastError: undefined })
  } catch (cause: any) {
    const message = String(cause?.message || '企业微信回复失败').slice(0, 300)
    patchState({ lastError: message })
    console.error('[wecom] reply failed:', message)
  }
})

export function acceptWeComMessage(message: WeComMessage) {
  if (message.messageType !== 'text' || !message.text.trim()) return false
  const sessionId = targetSessionId()
  const part: WeChatTurnPart = {
    externalId: `wecom-${message.messageId}`,
    text: message.text,
    images: [],
    timestamp: message.timestamp,
  }
  const batchId = batcher.peek()?.batchId || createWeChatBatchId(part.externalId)
  const persisted = persistWeChatPart(sessionId, batchId, part)
  if (!persisted.appended) return false
  batcher.add({ ...part, batchId, replyUserId: message.fromUserId })
  patchState({ lastMessageAt: new Date().toISOString(), lastError: undefined })
  return true
}
