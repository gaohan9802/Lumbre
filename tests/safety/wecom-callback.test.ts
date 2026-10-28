import assert from 'node:assert/strict'
import { createCipheriv, createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { NextRequest } from 'next/server'

const envKeys = [
  'LUMBRE_WECOM_CORP_ID', 'LUMBRE_WECOM_AGENT_ID', 'LUMBRE_WECOM_SECRET',
  'LUMBRE_WECOM_CALLBACK_TOKEN', 'LUMBRE_WECOM_CALLBACK_AES_KEY',
] as const

const corpId = 'ww1234567890abcdef'
const token = 'callbacktoken'
const aesKeyRaw = Buffer.alloc(32, 7).toString('base64').replace(/=$/, '')
const originalDataDir = process.env.DATA_DIR
const dataDir = mkdtempSync(path.join(tmpdir(), 'lumbre-wecom-callback-'))
process.env.DATA_DIR = dataDir

after(() => {
  originalDataDir == null ? delete process.env.DATA_DIR : process.env.DATA_DIR = originalDataDir
  rmSync(dataDir, { recursive: true, force: true })
})

function configure() {
  process.env.LUMBRE_WECOM_CORP_ID = corpId
  process.env.LUMBRE_WECOM_AGENT_ID = '1000002'
  process.env.LUMBRE_WECOM_SECRET = 'app-secret'
  process.env.LUMBRE_WECOM_CALLBACK_TOKEN = token
  process.env.LUMBRE_WECOM_CALLBACK_AES_KEY = aesKeyRaw
}

function envelope(message: string, receiveId = corpId) {
  const key = Buffer.from(`${aesKeyRaw}=`, 'base64')
  const content = Buffer.from(message)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(content.length)
  const plain = Buffer.concat([Buffer.alloc(16, 3), length, content, Buffer.from(receiveId)])
  const padding = 32 - (plain.length % 32)
  const padded = Buffer.concat([plain, Buffer.alloc(padding, padding)])
  const cipher = createCipheriv('aes-256-cbc', key, key.subarray(0, 16))
  cipher.setAutoPadding(false)
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]).toString('base64')
  const timestamp = '1700000000'
  const nonce = 'nonce'
  const signature = createHash('sha1').update([token, timestamp, nonce, encrypted].sort().join('')).digest('hex')
  return { signature, timestamp, nonce, encrypted }
}

test('wecom callback validates, decrypts and parses a text message', () => {
  return import('../../src/server/wechat/wecom').then(({ decodeWeComEnvelope, parseWeComMessage }) => {
  const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  configure()
  try {
    const xml = '<xml><FromUserName><![CDATA[fire]]></FromUserName><CreateTime>1700000000</CreateTime><MsgType><![CDATA[text]]></MsgType><Content><![CDATA[你好星星]]></Content><MsgId>42</MsgId></xml>'
    const decoded = decodeWeComEnvelope(envelope(xml))
    assert.equal(decoded, xml)
    assert.deepEqual(parseWeComMessage(decoded), {
      fromUserId: 'fire', messageId: '42', messageType: 'text', text: '你好星星', timestamp: 1_700_000_000_000,
    })
    assert.throws(() => decodeWeComEnvelope({ ...envelope(xml), signature: 'bad' }), /签名无效/)
    assert.throws(() => decodeWeComEnvelope(envelope(xml, 'other-corp')), /企业不匹配/)
  } finally {
    for (const key of envKeys) saved[key] == null ? delete process.env[key] : process.env[key] = saved[key]
  }
  })
})

test('wecom callback endpoint returns the decrypted verification echo', async () => {
  const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  configure()
  try {
    const value = envelope('verification-ok')
    const query = new URLSearchParams({
      msg_signature: value.signature,
      timestamp: value.timestamp,
      nonce: value.nonce,
      echostr: value.encrypted,
    })
    const route = await import('../../src/app/api/wecom/callback/route')
    const middleware = await import('../../src/middleware')
    const gate = await middleware.middleware(new NextRequest('https://xsidereal.beer/api/wecom/callback'))
    assert.equal(gate.status, 200)
    assert.equal(gate.headers.get('x-middleware-next'), '1')
    const response = await route.GET(new NextRequest(`https://xsidereal.beer/api/wecom/callback?${query}`))
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'verification-ok')
  } finally {
    for (const key of envKeys) saved[key] == null ? delete process.env[key] : process.env[key] = saved[key]
  }
})

test('wecom sends natural reply bubbles through one cached access token', async () => {
  const { sendWeComText } = await import('../../src/server/wechat/wecom')
  const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
  const originalFetch = globalThis.fetch
  configure()
  const requests: Array<{ url: string; init?: RequestInit }> = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    if (String(url).includes('/gettoken?')) return Response.json({ errcode: 0, access_token: 'access', expires_in: 7200 })
    return Response.json({ errcode: 0, errmsg: 'ok' })
  }) as typeof fetch
  try {
    await sendWeComText('fire', '第一条。\n\n第二条！\n\n第三条。\n\n第四条。')
    assert.equal(requests.filter(request => request.url.includes('/gettoken?')).length, 1)
    const messages = requests.filter(request => request.url.includes('/message/send?'))
      .map(request => JSON.parse(String(request.init?.body)))
    assert.deepEqual(messages.map(message => message.text.content), ['第一条。', '第二条！', '第三条。', '第四条。'])
    assert.ok(messages.every(message => message.touser === 'fire' && message.agentid === 1000002))
  } finally {
    globalThis.fetch = originalFetch
    for (const key of envKeys) saved[key] == null ? delete process.env[key] : process.env[key] = saved[key]
  }
})
