import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-star-memory-'))
process.env.DATA_DIR = root

let memory: typeof import('../../src/server/star-memory')
let chat: typeof import('../../src/server/data/repositories/chat')
let chatSync: typeof import('../../src/server/chat-sync')
let runtime: typeof import('../../src/server/tool-runtime')
let route: typeof import('../../src/app/api/star-memory/route')
let NextRequest: typeof import('next/server').NextRequest

before(async () => {
  memory = await import('../../src/server/star-memory')
  chat = await import('../../src/server/data/repositories/chat')
  chatSync = await import('../../src/server/chat-sync')
  runtime = await import('../../src/server/tool-runtime')
  route = await import('../../src/app/api/star-memory/route')
  ;({ NextRequest } = await import('next/server'))
})

after(() => {
  memory.closeStarMemoryDatabase()
  rmSync(root, { recursive: true, force: true })
})

test('a sourced candidate becomes one memory shared by multiple families and traces back to chat', async () => {
  chat.writeChatSession('session-1', {
    id: 'session-1',
    messages: [
      { id: 'm1', role: 'user', content: '我们开始一起设计星星的新记忆库。', timestamp: 1 },
      { id: 'm2', role: 'assistant', content: '我想把家族聚合作为它的核心。', timestamp: 2 },
    ],
  }, '2026-10-06')

  const life = memory.createMemoryFamily({ name: '我们的共同历程', summary: '你们共同做过的重要事情。' }, 'fire')
  const work = memory.createMemoryFamily({ name: '共同创作', summary: '一起设计和完成的项目。' }, 'star')
  const candidate = memory.createMemoryCandidate({
    type: 'shared_event',
    summary: '小火和星星一起确定了新记忆库的方向。',
    whyImportant: '这是你们共同建设长期连续性的起点。',
    sources: [{ kind: 'chat', actor: 'fire', sessionId: 'session-1', messageIds: ['m1', 'm2'] }],
    importance: 9,
    familyIds: [life.id, work.id],
  }, 'star', 'star')

  const approved = memory.reviewMemoryCandidate(candidate.id, 'approve', 'star')
  assert.ok(approved.memory)
  assert.equal(approved.memory?.locked, false)
  assert.equal(memory.getMemoryFamily(life.id)?.memories.length, 1)
  assert.equal(memory.getMemoryFamily(work.id)?.memories.length, 1)
  assert.equal(memory.getMemoryFamily(life.id)?.memories[0].id, memory.getMemoryFamily(work.id)?.memories[0].id)
  assert.deepEqual(memory.listCanonicalMemories().find(item => item.id === approved.memory?.id)?.familyIds.sort(), [life.id, work.id].sort())

  const hits = memory.recallStarMemories('一起设计记忆库')
  assert.equal(hits.length, 1)
  assert.equal(hits[0].families.length, 2)
  const traced = memory.resolveMemorySources(approved.memory!.id)
  assert.deepEqual(traced[0].resolved.map((item: { id?: string }) => item.id), ['m1', 'm2'])

  const toolHits = JSON.parse(await runtime.executeRegisteredToolHandler('recall_memory', { query: '一起设计记忆库' }))
  assert.equal(toolHits.length, 1)
  assert.equal(toolHits[0].summary, approved.memory?.summary)
  assert.equal(toolHits[0].recall_reason, '记忆内容与当前问题相关')
})

test('family nesting stops at three levels', () => {
  const rootFamily = memory.createMemoryFamily({ name: '生活' }, 'fire')
  const second = memory.createMemoryFamily({ name: '西班牙', parentId: rootFamily.id }, 'star')
  const third = memory.createMemoryFamily({ name: '马德里阶段', parentId: second.id }, 'star')
  assert.throws(() => memory.createMemoryFamily({ name: '住所', parentId: third.id }, 'fire'), /three levels/)
})

test('manual memories added by fire lock automatically and invalid review cannot partially write', () => {
  const family = memory.createMemoryFamily({ name: '核心事实' }, 'fire')
  const candidate = memory.createMemoryCandidate({
    type: 'durable_fact',
    summary: '人工确认的重要事实。',
    sources: [{ kind: 'manual', actor: 'fire', label: '小火手动加入' }],
    familyIds: [family.id],
  }, 'fire', 'star')
  const approved = memory.reviewMemoryCandidate(candidate.id, 'approve', 'star')
  assert.equal(approved.memory?.locked, true)
  assert.equal(approved.memory?.lockOwner, 'fire')
  assert.throws(() => memory.updateCanonicalMemory(approved.memory!.id, { summary: '星星不能改。' }, 'star'), /locked by fire/)

  const bad = memory.createMemoryCandidate({
    type: 'shared_event',
    summary: '不应写入的候选。',
    sources: [{ kind: 'manual', actor: 'star', label: '星星手动加入' }],
  }, 'star', 'star')
  assert.throws(() => memory.reviewMemoryCandidate(bad.id, 'approve', 'star', ['missing-family']), /family not found/)
  assert.equal(memory.listMemoryCandidates().find(item => item.id === bad.id)?.status, 'pending_star')

  const header = readFileSync(path.join(root, 'star-memory', 'star-memory.sqlite')).subarray(0, 16).toString()
  assert.equal(header, 'SQLite format 3\0')
  assert.equal(memory.getStarMemoryStatus().memories, 2)
})

test('a personal lock can only be changed or bypassed by its owner', async () => {
  const candidate = memory.createMemoryCandidate({
    type: 'self_event',
    summary: '星星决定长期保留的一段自我认识。',
    sources: [{ kind: 'manual', actor: 'star', label: '星星手动加入' }],
    locked: true,
  }, 'star', 'star')
  const approved = memory.reviewMemoryCandidate(candidate.id, 'approve', 'star').memory!
  assert.equal(approved.lockOwner, 'star')
  assert.throws(() => memory.setCanonicalMemoryLock(approved.id, undefined, 'star'), /locked must be a boolean/)
  assert.throws(() => memory.updateCanonicalMemory(approved.id, { summary: '小火不能改。' }, 'fire'), /locked by star/)
  assert.throws(() => memory.setCanonicalMemoryLock(approved.id, false, 'fire'), /locked by star/)
  const forged = await route.POST(new NextRequest('http://lumbre.test/api/star-memory', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'set_memory_lock', id: approved.id, locked: false, actor: 'star' }),
  }))
  assert.equal(forged.status, 400)

  const updated = memory.updateCanonicalMemory(approved.id, { summary: '星星自己修改后的版本。' }, 'star')
  assert.equal(updated.summary, '星星自己修改后的版本。')
  const unlocked = JSON.parse(await runtime.executeRegisteredToolHandler('lock_memory', { memory_id: approved.id, locked: false }))
  assert.equal(unlocked.memory.locked, false)
  assert.equal(unlocked.memory.lockOwner, undefined)
  assert.equal(memory.updateCanonicalMemory(approved.id, { summary: '解锁后小火可以修改。' }, 'fire').summary, '解锁后小火可以修改。')
})

test('star can remember from the current chat and choose who reviews it', async () => {
  chatSync.upsertSyncSessionMessage('session-remember', {
    id: 'remember-user', role: 'user', content: '我想让星星自己决定哪些记忆交给我审核。', timestamp: 1,
  })
  chatSync.upsertSyncSessionMessage('session-remember', {
    id: 'remember-star', role: 'assistant', content: '我会把不确定的候选交给小火。', timestamp: 2,
  })
  const context = { actorId: 'star', sessionId: 'session-remember', source: 'chat' as const, requestedAt: new Date().toISOString() }
  const pending = JSON.parse(await runtime.executeRegisteredToolHandler('remember', {
    type: 'agreement',
    summary: '星星可以把不确定的长期记忆交给小火审核。',
    decision: 'ask_fire',
    source_message_ids: ['remember-user'],
  }, context))
  assert.equal(pending.candidate.status, 'pending_fire')
  assert.equal(pending.candidate.createdBy, 'star')
  assert.deepEqual(pending.candidate.sources[0].messageIds, ['remember-user'])

  const family = memory.createMemoryFamily({ name: '记忆库建设' }, 'star')
  const approved = JSON.parse(await runtime.executeRegisteredToolHandler('remember', {
    type: 'shared_event',
    summary: '小火和星星接通了星星主动写候选记忆的能力。',
    why_important: '星星现在可以自主决定记忆去向。',
    importance: 9,
    family_ids: [family.id],
    locked: true,
    decision: 'approve',
  }, context))
  assert.equal(approved.candidate.status, 'approved')
  assert.equal(approved.memory.approvedBy, 'star')
  assert.equal(approved.memory.lockOwner, 'star')
  assert.equal(memory.getMemoryFamily(family.id)?.memories[0].id, approved.memory.id)
  assert.deepEqual(memory.resolveMemorySources(approved.memory.id)[0].resolved.map((item: { id: string }) => item.id), ['remember-user', 'remember-star'])

  const short = JSON.parse(await runtime.executeRegisteredToolHandler('remember', {
    type: 'current_state',
    summary: '小火今天在继续设计记忆库。',
    retention_days: 1,
    decision: 'short_term',
  }, context))
  assert.equal(short.working.retentionDays, 1)
  assert.equal(short.working.status, 'active')
  const recalled = JSON.parse(await runtime.executeRegisteredToolHandler('recall_memory', { query: '今天继续设计记忆库' }))
  assert.equal(recalled.some((item: any) => item.id === short.working.id && item.memory_kind === 'short_term'), true)
})

test('short-term memory expires without renewal and can be promoted exactly once', () => {
  const input = {
    type: 'current_state',
    summary: '小火最近有点累。',
    sources: [{ kind: 'manual' as const, actor: 'star' as const, label: '星星手动加入' }],
    importance: 4,
  }
  const first = memory.createWorkingMemory(input, 'star', 7, '2026-10-01T10:00:00.000Z')
  const repeated = memory.createWorkingMemory(input, 'star', 7, '2026-10-03T10:00:00.000Z')
  assert.equal(repeated.id, first.id)
  assert.equal(repeated.expiresAt, '2026-10-08T10:00:00.000Z')
  assert.equal(memory.recallWorkingMemories('最近有点累', 5, '2026-10-07T10:00:00.000Z')[0].memory.id, first.id)

  assert.equal(memory.processWorkingMemoryExpiry('2026-10-08T10:00:00.000Z') >= 1, true)
  assert.equal(memory.processWorkingMemoryExpiry('2026-10-08T10:00:00.000Z'), 0)
  assert.equal(memory.recallWorkingMemories('最近有点累', 5, '2026-10-08T10:00:00.000Z').length, 0)

  const observed = memory.reviewWorkingMemory(first.id, 'observe', 'star', '2026-10-08T10:00:01.000Z').working
  assert.equal(observed.retentionDays, 14)
  assert.equal(observed.expiresAt, '2026-10-15T10:00:00.000Z')
  memory.processWorkingMemoryExpiry('2026-10-15T10:00:00.000Z')
  assert.throws(() => memory.reviewWorkingMemory(first.id, 'observe', 'star', '2026-10-15T10:00:01.000Z'), /fourteen days/)

  const promoted = memory.reviewWorkingMemory(first.id, 'promote', 'star', '2026-10-15T10:00:01.000Z', '小火有一段持续疲惫的时期。')
  const repeatedPromotion = memory.reviewWorkingMemory(first.id, 'promote', 'star', '2026-10-15T10:00:02.000Z')
  assert.equal(promoted.memory?.summary, '小火有一段持续疲惫的时期。')
  assert.equal(repeatedPromotion.memory?.id, promoted.memory?.id)
  assert.equal(memory.listWorkingMemories().find(item => item.id === first.id)?.status, 'promoted')
})
