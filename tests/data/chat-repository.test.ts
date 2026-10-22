import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

test('an ancient favorite locates its bounded original chat context', () => {
  const context = sync.loadSyncMessageContext('legacy-session', 'legacy-message')
  assert.equal(context?.sessionId, 'legacy-session')
  assert.equal(context?.messages[0]?.content, 'legacy body')
  assert.equal(sync.loadSyncMessageContext('legacy-session', 'missing-message'), null)
})

test('a deleted session cannot be reopened through its retained recovery backup', () => {
  const id = 'deleted-session'
  sync.upsertSyncSessionMessage(id, { id: 'deleted-message', role: 'user', content: 'gone', timestamp: 1 })
  const deletedAt = Date.now() + 100
  sync.mergeSyncDelta({ sessions: [], tombstones: { [id]: deletedAt } })

  assert.equal(sync.loadSyncMessageContext(id, 'deleted-message'), null)
})

test('session updates retain the historical backup layout and recover corrupt primary JSON', () => {
  const id = 'fixture-session'
  sync.upsertSyncSessionMessage(id, { id: 'one', role: 'user', content: 'one', timestamp: 10 }, { title: 'fixture' })
  sync.upsertSyncSessionMessage(id, { id: 'two', role: 'assistant', content: 'two', timestamp: 20 }, { title: 'fixture' })

  const file = path.join(root, 'chat', 'sessions', `${encoded(id)}.json`)
  const backup = path.join(root, 'chat', 'sessions', `${encoded(id)}.bak`)
  assert.equal(JSON.parse(readFileSync(file, 'utf8'))._messageStore.messageCount, 2)
  assert.equal(JSON.parse(readFileSync(backup, 'utf8'))._messageStore.messageCount, 1)

  writeFileSync(file, '{broken session json', 'utf8')
  assert.equal(sync.loadSyncSessions([id])[0]?.messages.length, 1)
})

test('chat images are stored outside the session JSON and remain readable by reference', async () => {
  const image = 'data:image/png;base64,aGVsbG8='
  sync.upsertSyncSessionMessage('image-session', {
    id: 'image-message', role: 'user', content: 'image', images: [image], timestamp: 30,
  })
  const stored = sync.loadSyncSessions(['image-session'])[0].messages[0].images[0]
  assert.match(stored, /^\/api\/chat-assets\/[a-f0-9]{64}\.png$/)
  assert.doesNotMatch(readFileSync(path.join(root, 'chat', 'sessions', `${encoded('image-session')}.json`), 'utf8'), /aGVsbG8=/)
  const assets = await import('../../src/server/data/repositories/chat-assets')
  assert.equal(assets.chatImageDataUrl(stored), image)
})

test('long sessions read and append only bounded message chunks', () => {
  const id = 'long-session'
  const messages = Array.from({ length: 600 }, (_, index) => ({
    id: `message-${index}`, role: index % 2 ? 'assistant' : 'user', content: String(index), timestamp: index + 1,
  }))
  sync.mergeSyncDelta({
    sessions: [{ id, title: 'long', createdAt: 1, updatedAt: 600, messages }],
    tombstones: {},
  })
  const chunks = path.join(root, 'chat', 'session-chunks', encoded(id))
  const generation = readdirSync(chunks)[0]
  const firstChunk = path.join(chunks, generation, '000000.json')
  const before = readFileSync(firstChunk, 'utf8')

  sync.upsertSyncSessionMessage(id, { id: 'message-600', role: 'user', content: '600', timestamp: 601 })

  assert.equal(readFileSync(firstChunk, 'utf8'), before)
  assert.equal(readdirSync(path.join(chunks, generation)).filter(file => /^\d{6}\.json$/.test(file)).length, 3)
  assert.equal('_messageStore' in sync.loadSyncSessionTails([id], 20)[0], false)
  assert.deepEqual(sync.loadSyncSessionTails([id], 20)[0].messages.map((message: any) => message.id),
    Array.from({ length: 20 }, (_, index) => `message-${581 + index}`))
  assert.deepEqual(sync.loadSyncSessionHistory(id, 581, 50)?.messages.map((message: any) => message.id),
    Array.from({ length: 50 }, (_, index) => `message-${531 + index}`))
})

test('a duplicate retry repairs a manifest left stale after the chunk was committed', async () => {
  const id = 'manifest-repair-session'
  sync.upsertSyncSessionMessage(id, { id: 'first', role: 'user', content: 'first', timestamp: 1 })
  const repository = await import('../../src/server/data/repositories/chat')
  const header = repository.readChatSessionHeader(id) as any
  const updatedAt = Number(header.updatedAt) + 1
  repository.appendChatSessionMessage(
    id,
    { id: 'second', role: 'assistant', content: 'second', timestamp: updatedAt },
    { ...header, updatedAt },
    '2026-10-22',
    false,
  )

  assert.equal(sync.loadSyncManifest().sessions.find(session => session.id === id)?.messageCount, 1)
  const result = sync.upsertSyncSessionMessage(id, { id: 'second', role: 'assistant', content: 'second', timestamp: updatedAt })

  assert.equal(result.appended, false)
  assert.equal(sync.loadSyncManifest().sessions.find(session => session.id === id)?.messageCount, 2)
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
  const chunksRoot = path.join(childRoot, 'chat', 'session-chunks', encoded(sessionId))
  const generation = readdirSync(chunksRoot)[0]
  const chunks = readdirSync(path.join(chunksRoot, generation))
    .filter(file => /^\d{6}\.json$/.test(file)).sort()
    .flatMap(file => JSON.parse(readFileSync(path.join(chunksRoot, generation, file), 'utf8')))
  assert.equal(manifest.sessions[0]?.messageCount, 40)
  assert.equal(session._messageStore.messageCount, 40)
  assert.equal(chunks.length, 40)
  assert.equal(new Set(chunks.map((message: any) => message.id)).size, 40)
})
