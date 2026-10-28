import assert from 'node:assert/strict'
import test from 'node:test'
import { startWeChatQrLogin, WeChatClient } from '../../src/server/wechat/client'

test('wechat login content is rendered as an embedded QR image', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () => Response.json({
    qrcode: 'qr-id',
    qrcode_img_content: 'https://liteapp.weixin.qq.com/example-login-content',
  })) as typeof fetch
  try {
    const login = await startWeChatQrLogin()
    assert.equal(login.qrcodeId, 'qr-id')
    assert.match(login.qrcodeUrl, /^data:image\/svg\+xml;charset=utf-8,/)
    assert.match(decodeURIComponent(login.qrcodeUrl.split(',', 2)[1]), /^<svg/)
  } finally { globalThis.fetch = originalFetch }
})

test('wechat replies use separate bot messages and preserve the inbound context token', async () => {
  const originalFetch = globalThis.fetch
  const originalNow = Date.now
  const requests: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    return Response.json({ ret: 0 })
  }) as typeof fetch
  let now = 0
  Date.now = () => { now += 3_000; return now }
  try {
    const client = new WeChatClient({ botToken: 'secret', accountId: 'bot-id', userId: 'user-id', baseUrl: 'https://ilinkai.weixin.qq.com' })
    await client.sendText('peer-id', 'context-token', '第一条。\n\n第二条！\n\n第三条。\n\n第四条。')
    assert.equal(requests.length, 4)
    const bodies = requests.map(request => JSON.parse(String(request.init?.body)))
    assert.ok(requests.every(request => request.url === 'https://ilinkai.weixin.qq.com/ilink/bot/sendmessage'))
    assert.ok(requests.every(request => (request.init?.headers as Record<string, string>).Authorization === 'Bearer secret'))
    assert.ok(bodies.every(body => body.msg.from_user_id === '' && body.msg.to_user_id === 'peer-id'))
    assert.ok(bodies.every(body => body.msg.context_token === 'context-token'))
    assert.deepEqual(bodies.map(body => body.msg.item_list[0].text_item.text), ['第一条。', '第二条！', '第三条。', '第四条。'])
  } finally {
    globalThis.fetch = originalFetch
    Date.now = originalNow
  }
})

test('wechat client refuses a persisted API base outside the official hosts', async () => {
  const client = new WeChatClient({ botToken: 'secret', accountId: 'bot-id', userId: 'user-id', baseUrl: 'https://example.com' })
  await assert.rejects(() => client.getUpdates(''), /不受信任/)
})
