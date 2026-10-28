import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('wechat status never exposes the stored bot token or account identifiers', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-wechat-api-'))
  const previous = process.env.DATA_DIR
  process.env.DATA_DIR = root
  try {
    const store = await import('../../src/server/wechat/store')
    store.writeWeChatConnection({
      botToken: 'private-bot-token',
      accountId: 'private-bot-id',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      userId: 'private-user-id',
      targetSessionId: 'main',
      connectedAt: '2026-10-28T00:00:00.000Z',
    })
    const route = await import('../../src/app/api/wechat/route')
    const response = await route.GET()
    const text = await response.text()
    const data = JSON.parse(text)
    assert.equal(data.connected, true)
    assert.equal(data.targetSessionId, 'main')
    assert.doesNotMatch(text, /private-bot-token|private-bot-id|private-user-id|ilinkai/)
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previous
    rmSync(root, { recursive: true, force: true })
  }
})
