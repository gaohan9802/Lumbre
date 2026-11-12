import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-work-summary-'))
process.env.DATA_DIR = root

let chat: typeof import('../../src/server/chat-sync')
let work: typeof import('../../src/server/work-summary')

before(async () => {
  chat = await import('../../src/server/chat-sync')
  work = await import('../../src/server/work-summary')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('work daily maintenance is due only for the active work window', () => {
  const now = Date.parse('2026-11-12T06:00:00+01:00')
  chat.upsertSyncSessionMessage('work-session', {
    id: 'work-u1', role: 'user', content: 'inspect the repo', timestamp: Date.parse('2026-11-11T10:00:00+01:00'),
  }, { title: 'work', windowRole: 'work', windowRoleUpdatedAt: now - 1 })
  chat.upsertSyncSessionMessage('work-session', {
    id: 'work-a1', role: 'assistant', content: 'inspection done', timestamp: Date.parse('2026-11-11T10:01:00+01:00'),
  }, { title: 'work', windowRole: 'work', windowRoleUpdatedAt: now - 1 })
  assert.equal(work.workSummaryNeedsRun(now), true)

  chat.mergeSyncDelta({ sessions: [{ ...chat.loadSyncSessions(['work-session'])[0], windowRole: 'archived', windowRoleUpdatedAt: now, updatedAt: now }], tombstones: {} })
  assert.equal(work.workSummaryNeedsRun(now), false)
})
