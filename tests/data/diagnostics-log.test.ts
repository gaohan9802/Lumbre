import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-diagnostics-log-'))
process.env.DATA_DIR = root
let diagnostics: typeof import('../../src/server/data/diagnostics')
let log: typeof import('../../src/server/data/log')

before(async () => {
  diagnostics = await import('../../src/server/data/diagnostics')
  log = await import('../../src/server/data/log')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('development filesystem diagnostics still inspect isolated data', () => {
  const buckets = path.join(root, 'buckets')
  mkdirSync(buckets, { recursive: true })
  writeFileSync(path.join(buckets, 'abcdef123456.json'), JSON.stringify({ id: 'abcdef123456', metadata: {} }), 'utf8')
  writeFileSync(path.join(root, 'chat-sync.json'), JSON.stringify({ sessions: [{ id: 'fixture', messages: [] }] }), 'utf8')

  assert.equal(diagnostics.inspectDataFilesystem().jsonFiles, 1)
  assert.equal(diagnostics.inspectLegacyChatSessions().count, 1)
  assert.equal(diagnostics.inspectLegacyChatRaw().fileSize, readFileSync(path.join(root, 'chat-sync.json'), 'utf8').length)
  assert.equal((diagnostics.inspectPersistentData().chatSync as any).writable, true)
  assert.equal(existsSync(path.join(root, '.write-probe')), false)
})

test('chat upstream diagnostics follow DATA_DIR and remain append-only', () => {
  assert.equal(log.appendChatUpstreamError('{"fixture":1}\n'), true)
  assert.equal(log.appendChatUpstreamError('{"fixture":2}\n'), true)
  assert.equal(readFileSync(path.join(root, 'chat-upstream-errors.jsonl'), 'utf8'), '{"fixture":1}\n{"fixture":2}\n')
})
