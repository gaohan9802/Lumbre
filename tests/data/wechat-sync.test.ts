import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('wechat inbound messages are durably appended before a model reply exists', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-wechat-sync-'))
  const previous = process.env.DATA_DIR
  process.env.DATA_DIR = root
  try {
    const sync = await import('../../src/server/chat-sync')
    const turn = await import('../../src/server/wechat/turn')
    sync.upsertSyncSessionMessage('main', { id: 'seed', role: 'user', content: '原来的消息', timestamp: 1 }, { title: 'Leopardo', createdAt: 1 })
    const part = { externalId: 'wx-1', text: '第一条', images: [], timestamp: 10 }
    const first = turn.persistWeChatPart('main', 'wechat-batch', part)
    const repeated = turn.persistWeChatPart('main', 'wechat-batch', part)
    const stored = sync.loadSyncSessionTails(['main'], 10)[0].messages.at(-1)

    assert.equal(first.appended, true)
    assert.equal(repeated.appended, false)
    assert.equal(stored.content, '第一条')
    assert.equal(stored.transport, 'wechat')
    assert.equal(stored.transportBatchId, 'wechat-batch')
    assert.equal(stored.transportExternalId, 'wx-1')
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = previous
    rmSync(root, { recursive: true, force: true })
  }
})
