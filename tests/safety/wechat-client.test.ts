import assert from 'node:assert/strict'
import test from 'node:test'
import { WeChatClient } from '../../src/server/wechat/client'

test('wechat replies use the official bot message shape and preserve the inbound context token', async () => {
  const originalFetch = globalThis.fetch
  let request: { url: string; init?: RequestInit } | undefined
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init }
    return Response.json({ ret: 0 })
  }) as typeof fetch
  try {
    const client = new WeChatClient({ botToken: 'secret', accountId: 'bot-id', userId: 'user-id', baseUrl: 'https://ilinkai.weixin.qq.com' })
    await client.sendText('peer-id', 'context-token', '你好')
    const body = JSON.parse(String(request?.init?.body))
    assert.equal(request?.url, 'https://ilinkai.weixin.qq.com/ilink/bot/sendmessage')
    assert.equal((request?.init?.headers as Record<string, string>).Authorization, 'Bearer secret')
    assert.equal(body.msg.from_user_id, '')
    assert.equal(body.msg.to_user_id, 'peer-id')
    assert.equal(body.msg.context_token, 'context-token')
    assert.equal(body.msg.item_list[0].text_item.text, '你好')
  } finally { globalThis.fetch = originalFetch }
})

test('wechat client refuses a persisted API base outside the official hosts', async () => {
  const client = new WeChatClient({ botToken: 'secret', accountId: 'bot-id', userId: 'user-id', baseUrl: 'https://example.com' })
  await assert.rejects(() => client.getUpdates(''), /不受信任/)
})
