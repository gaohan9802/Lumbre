import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'

import { DataPathError } from '../../src/server/data/errors'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-chat-repository-'))
process.env.DATA_DIR = root
const legacy = {
  sessions: [{
    id: 'legacy-session', title: 'legacy', createdAt: 1, updatedAt: 2,
    messages: [{ id: 'legacy-message', role: 'user', content: 'legacy body', timestamp: 1 }],
  }],
  tombstones: {},
  configUpdatedAt: 0,
}
writeFileSync(path.join(root, 'chat-sync.json'), JSON.stringify(legacy), 'utf8')
let sync: typeof import('../../src/server/chat-sync')

before(async () => { sync = await import('../../src/server/chat-sync') })
after(() => rmSync(root, { recursive: true, force: true }))

function encoded(id: string): string {
  return Buffer.from(id).toString('base64url')
}

test('legacy monolithic chat data migrates without changing its content', () => {
  const manifest = sync.loadSyncManifest()
  assert.equal(manifest.sessions[0]?.id, 'legacy-session')
  assert.equal(sync.loadSyncSessions(['legacy-session'])[0]?.messages[0]?.content, 'legacy body')
  assert.equal(existsSync(path.join(root, 'chat-sync.pre-v2.json')), true)
  assert.equal(existsSync(path.join(root, 'chat', 'sessions', `${encoded('legacy-session')}.json`)), true)
})

test('session updates retain the historical backup layout and recover corrupt primary JSON', () => {
  const id = 'fixture-session'
  sync.upsertSyncSessionMessage(id, { id: 'one', role: 'user', content: 'one', timestamp: 10 }, { title: 'fixture' })
  sync.upsertSyncSessionMessage(id, { id: 'two', role: 'assistant', content: 'two', timestamp: 20 }, { title: 'fixture' })

  const file = path.join(root, 'chat', 'sessions', `${encoded(id)}.json`)
  const backup = path.join(root, 'chat', 'sessions', `${encoded(id)}.bak`)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).messages.length, 2)
  assert.equal(JSON.parse(readFileSync(backup, 'utf8')).messages.length, 1)

  writeFileSync(file, '{broken session json', 'utf8')
  assert.equal(sync.loadSyncSessions([id])[0]?.messages.length, 1)
})

test('encoded client ids cannot escape the sessions directory and invalid ids are rejected', () => {
  const id = '../still-inside-chat'
  sync.upsertSyncSessionMessage(id, { id: 'safe', role: 'user', content: 'safe', timestamp: 1 })
  assert.equal(existsSync(path.join(root, 'chat', 'sessions', `${encoded(id)}.json`)), true)
  assert.equal(existsSync(path.join(root, 'still-inside-chat.json')), false)
  for (const invalid of ['', `bad\0id`, 'x'.repeat(201)]) {
    assert.throws(() => sync.upsertSyncSessionMessage(invalid, { id: 'bad' }), DataPathError)
  }
})

test('manifest corruption falls back to the preserved previous version', () => {
  const file = path.join(root, 'chat', 'manifest.json')
  const backup = path.join(root, 'chat', 'manifest.bak')
  assert.equal(existsSync(backup), true)
  writeFileSync(file, '{broken manifest json', 'utf8')
  assert.doesNotThrow(() => sync.loadSyncManifest())
  assert.equal(sync.loadSyncManifest().version, 2)
})

test('chat repository serializes concurrent messages without losing any', async () => {
  const worker = fileURLToPath(new URL('../fixtures/chat-sync-worker.ts', import.meta.url))
  const childRoot = path.join(root, 'concurrent')
  const sessionId = 'concurrent-session'

  await Promise.all(Array.from({ length: 4 }, (_, index) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', worker, sessionId, '10', String(index)], {
      env: { ...process.env, DATA_DIR: childRoot },
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`)))
  })))

  const manifest = JSON.parse(readFileSync(path.join(childRoot, 'chat', 'manifest.json'), 'utf8'))
  const session = JSON.parse(readFileSync(path.join(childRoot, 'chat', 'sessions', `${encoded(sessionId)}.json`), 'utf8'))
  assert.equal(manifest.sessions[0]?.messageCount, 40)
  assert.equal(session.messages.length, 40)
  assert.equal(new Set(session.messages.map((message: any) => message.id)).size, 40)
})
