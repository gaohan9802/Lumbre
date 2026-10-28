import { WeChatBatcher } from './batcher'
import { downloadWeChatImage, WeChatClient, type WeChatInboundMessage } from './client'
import {
  patchWeChatConnection,
  readWeChatConnection,
  readWeChatCursor,
  writeWeChatCursor,
  type WeChatConnection,
} from './store'
import {
  createWeChatBatchId,
  persistWeChatPart,
  runWeChatTurn,
  type WeChatTurnPart,
} from './turn'

type PendingPart = WeChatTurnPart & {
  batchId: string
  contextToken: string
  replyUserId: string
}

type MonitorState = {
  running: boolean
  pendingCount: number
  lastPollAt?: string
  lastError?: string
}

let monitorVersion = 0
let state: MonitorState = { running: false, pendingCount: 0 }
let activeBatcher: WeChatBatcher<PendingPart> | null = null

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function messageTimestamp(message: WeChatInboundMessage) {
  const raw = Number(message.create_time_ms) || Date.now()
  return raw < 10_000_000_000 ? raw * 1_000 : raw
}

function externalId(message: WeChatInboundMessage) {
  return String(message.message_id || `${message.from_user_id || 'wechat'}:${messageTimestamp(message)}:${JSON.stringify(message.item_list || [])}`)
}

async function parseInbound(message: WeChatInboundMessage): Promise<WeChatTurnPart | null> {
  const texts: string[] = []
  const images: string[] = []
  for (const item of message.item_list || []) {
    if ((item.type === 1 || item.text_item) && item.text_item?.text) {
      texts.push(String(item.text_item.text))
      continue
    }
    if (item.type === 2 || item.image_item) {
      try {
        const image = await downloadWeChatImage(item)
        if (image) images.push(image)
        else texts.push('[小火发来一张图片，但图片没有成功下载]')
      } catch {
        texts.push('[小火发来一张图片，但图片没有成功下载]')
      }
      continue
    }
    if (item.type === 3) texts.push('[小火发来一条微信语音，当前版本还不能读取]')
    else if (item.type === 4) texts.push('[小火发来一个微信文件，当前版本还不能读取]')
    else if (item.type === 5) texts.push('[小火发来一段微信视频，当前版本还不能读取]')
    else texts.push('[小火发了一个微信表情，当前版本还不能读取具体画面]')
  }
  if (!texts.length && !images.length) return null
  return {
    externalId: externalId(message),
    text: texts.join('\n') || '[图片]',
    images,
    timestamp: messageTimestamp(message),
  }
}

async function flushBatch(connection: WeChatConnection, client: WeChatClient, items: PendingPart[]) {
  if (!items.length) return
  const latest = items.at(-1)!
  state = { ...state, pendingCount: activeBatcher?.size || 0 }
  try { await client.sendTyping(latest.replyUserId, latest.contextToken, 1) } catch {}
  try {
    const result = await runWeChatTurn(
      connection.targetSessionId,
      items[0].batchId,
      items.map(({ batchId: _batchId, contextToken: _contextToken, replyUserId: _replyUserId, ...part }) => part),
    )
    await client.sendText(latest.replyUserId, latest.contextToken, result.text)
    patchWeChatConnection({ lastError: undefined, lastMessageAt: new Date().toISOString() })
    state = { ...state, lastError: undefined }
  } catch (cause: any) {
    const message = String(cause?.message || '微信回复失败').slice(0, 300)
    patchWeChatConnection({ lastError: message })
    state = { ...state, lastError: message }
  } finally {
    try { await client.sendTyping(latest.replyUserId, latest.contextToken, 2) } catch {}
  }
}

async function acceptInbound(connection: WeChatConnection, batcher: WeChatBatcher<PendingPart>, message: WeChatInboundMessage) {
  if (!message.from_user_id || message.from_user_id !== connection.userId || !message.context_token) return
  const part = await parseInbound(message)
  if (!part) return
  const batchId = batcher.peek()?.batchId || createWeChatBatchId(part.externalId)
  const persisted = persistWeChatPart(connection.targetSessionId, batchId, part)
  if (!persisted.appended) return
  batcher.add({ ...part, batchId, contextToken: message.context_token, replyUserId: message.from_user_id })
  state = { ...state, pendingCount: batcher.size }
  patchWeChatConnection({ lastMessageAt: new Date().toISOString(), lastError: undefined })
}

async function poll(version: number, connection: WeChatConnection) {
  const client = new WeChatClient(connection)
  const batcher = new WeChatBatcher<PendingPart>(items => flushBatch(connection, client, items))
  activeBatcher = batcher
  let cursor = readWeChatCursor()
  let failures = 0
  state = { running: true, pendingCount: 0 }
  try { await client.notifyStart() } catch {}
  while (monitorVersion === version) {
    try {
      const response = await client.getUpdates(cursor)
      if (monitorVersion !== version) break
      const code = Number(response.ret ?? response.errcode ?? 0)
      if (code === -14) throw new Error('微信登录已失效，请重新扫码连接')
      if (code !== 0) throw new Error(response.errmsg || `微信拉取失败 (${code})`)
      if (typeof response.get_updates_buf === 'string') {
        cursor = response.get_updates_buf
        writeWeChatCursor(cursor)
      }
      for (const message of response.msgs || []) await acceptInbound(connection, batcher, message)
      failures = 0
      state = { ...state, lastPollAt: new Date().toISOString(), lastError: undefined, pendingCount: batcher.size }
    } catch (cause: any) {
      if (monitorVersion !== version) break
      failures += 1
      const message = String(cause?.message || '微信连接异常').slice(0, 300)
      patchWeChatConnection({ lastError: message })
      state = { ...state, lastError: message }
      if (message.includes('登录已失效')) break
      await wait(Math.min(30_000, 3_000 * failures))
    }
  }
  if (monitorVersion === version) {
    await batcher.flush()
    activeBatcher = null
    state = { ...state, running: false, pendingCount: 0 }
  } else batcher.clear()
  try { await client.notifyStop() } catch {}
}

export function startWeChatMonitor() {
  const connection = readWeChatConnection()
  stopWeChatMonitor()
  if (!connection) return false
  const version = monitorVersion
  void poll(version, connection)
  return true
}

export function stopWeChatMonitor() {
  monitorVersion += 1
  activeBatcher?.clear()
  activeBatcher = null
  state = { ...state, running: false, pendingCount: 0 }
}

export function restartWeChatMonitor() {
  return startWeChatMonitor()
}

export function getWeChatMonitorStatus() {
  return { ...state }
}
