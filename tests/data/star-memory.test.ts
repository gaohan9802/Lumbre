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
  assert.equal(toolHits.status, 'reliable')
  assert.equal(toolHits.hits.length, 1)
  assert.equal(toolHits.hits[0].summary, approved.memory?.summary)
  assert.equal(toolHits.hits[0].recall_reason, '关键词或原话相关')
})

test('family nesting stops at three levels', () => {
  const rootFamily = memory.createMemoryFamily({ name: '生活' }, 'fire')
  const second = memory.createMemoryFamily({ name: '西班牙', parentId: rootFamily.id }, 'star')
  const third = memory.createMemoryFamily({ name: '马德里阶段', parentId: second.id }, 'star')
  assert.throws(() => memory.createMemoryFamily({ name: '住所', parentId: third.id }, 'fire'), /three levels/)
})

test('family roles, major revisions, compression, and personal locks stay consistent', async () => {
  const family = memory.createMemoryFamily({ name: '职业发展', summary: '仍在探索方向。' }, 'star')
  const ordinary = memory.reviewMemoryCandidate(memory.createMemoryCandidate({
    type: 'durable_fact', summary: '一条会被压缩的普通背景。', sources: [{ kind: 'manual', actor: 'star', label: '星星手动加入' }],
  }, 'star').id, 'approve', 'star').memory!
  const key = memory.reviewMemoryCandidate(memory.createMemoryCandidate({
    type: 'shared_event', summary: '一个需要保留的关键节点。', sources: [{ kind: 'manual', actor: 'star', label: '星星手动加入' }],
  }, 'star').id, 'approve', 'star').memory!

  memory.setMemoryFamilyMembership(family.id, ordinary.id, 'member', '背景', 'star')
  memory.setMemoryFamilyMembership(family.id, key.id, 'key_event', '阶段节点', 'star')
  const updated = memory.updateMemoryFamily(family.id, { summary: '已经进入新的阶段。', major: true, reason: '方向明确' }, 'star')
  assert.equal(updated.summary, '已经进入新的阶段。')
  assert.equal(memory.getMemoryFamily(family.id)?.revisions[0].summary, '仍在探索方向。')

  const ended = memory.endMemoryFamily(family.id, 'star')
  assert.equal(ended.removedOrdinaryMembers, 1)
  assert.deepEqual(memory.getMemoryFamily(family.id)?.memberships.map(item => item.memoryId), [key.id])
  assert.equal(memory.listCanonicalMemories().some(item => item.id === ordinary.id), true)

  memory.setMemoryFamilyLock(family.id, true, 'star')
  assert.throws(() => memory.updateMemoryFamily(family.id, { summary: '小火不能覆盖。' }, 'fire'), /locked by star/)
  assert.throws(() => memory.recycleMemoryFamily(family.id, 'fire'), /locked by star/)
  const toolFamily = JSON.parse(await runtime.executeRegisteredToolHandler('manage_memory_family', { action: 'get', family_id: family.id }))
  assert.equal(toolFamily.lockOwner, 'star')

  memory.setMemoryFamilyLock(family.id, false, 'star')
  const recycled = memory.recycleMemoryFamily(family.id, 'fire', '2026-10-06T10:00:00.000Z')
  assert.equal(memory.getMemoryFamily(family.id), null)
  assert.equal(memory.listCanonicalMemories().some(item => item.id === key.id), true)
  assert.equal(memory.listRecycledFamilies('2026-10-06T11:00:00.000Z')[0].id, recycled.id)
  const restored = memory.restoreMemoryFamily(recycled.id, 'fire')
  assert.equal(restored.id, family.id)
  assert.deepEqual(memory.getMemoryFamily(family.id)?.memberships.map(item => item.memoryId), [key.id])

  memory.recycleMemoryFamily(family.id, 'star', '2026-10-06T12:00:00.000Z')
  assert.equal(memory.purgeExpiredFamilyRecycleBin('2026-10-07T11:59:59.000Z'), 0)
  assert.equal(memory.purgeExpiredFamilyRecycleBin('2026-10-07T12:00:00.000Z'), 1)
  assert.equal(memory.listRecycledFamilies('2026-10-07T12:00:01.000Z').length, 0)
})

test('family recall expands by level and merge or split never duplicates memory bodies', () => {
  const source = memory.createMemoryFamily({ name: '写作探索', summary: '多个写作方向。' }, 'star')
  const target = memory.createMemoryFamily({ name: '论文写作', summary: '论文相关进展。' }, 'star')
  const first = memory.reviewMemoryCandidate(memory.createMemoryCandidate({
    type: 'shared_event', summary: '确定了论文结构。', sources: [{ kind: 'manual', actor: 'star', label: '星星手动加入' }],
  }, 'star').id, 'approve', 'star').memory!
  const second = memory.reviewMemoryCandidate(memory.createMemoryCandidate({
    type: 'durable_fact', summary: '形成了稳定写作方法。', sources: [{ kind: 'manual', actor: 'star', label: '星星手动加入' }],
  }, 'star').id, 'approve', 'star').memory!
  memory.setMemoryFamilyMembership(source.id, first.id, 'key_event', '结构节点', 'star')
  memory.setMemoryFamilyMembership(source.id, second.id, 'member', '背景', 'star')
  memory.setMemoryFamilyMembership(target.id, first.id, 'member', '已有交叉归属', 'star')

  assert.equal('memories' in memory.getMemoryFamilyLevel(source.id, 1)!, false)
  assert.deepEqual((memory.getMemoryFamilyLevel(source.id, 3) as any).memories.map((item: any) => item.id), [first.id])
  assert.equal((memory.getMemoryFamilyLevel(source.id, 4) as any).memories.length, 2)

  const before = memory.listCanonicalMemories().length
  const merged = memory.mergeMemoryFamilies(source.id, target.id, '论文写作已吸收相关探索。', 'star')
  assert.equal(merged.movedMemories, 2)
  assert.equal(memory.getMemoryFamily(source.id), null)
  assert.deepEqual(memory.getMemoryFamily(target.id)?.memories.map(item => item.id).sort(), [first.id, second.id].sort())
  assert.equal(memory.listCanonicalMemories().length, before)

  const split = memory.splitMemoryFamily(target.id, { name: '写作方法' }, [second.id], 'star')
  assert.equal(split.movedMemories, 1)
  assert.deepEqual(memory.getMemoryFamily(split.family.id)?.memories.map(item => item.id), [second.id])
  assert.deepEqual(memory.getMemoryFamily(target.id)?.memories.map(item => item.id), [first.id])
  assert.equal(memory.listCanonicalMemories().length, before)
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
  const memoriesBeforeInvalidReview = memory.getStarMemoryStatus().memories

  const bad = memory.createMemoryCandidate({
    type: 'shared_event',
    summary: '不应写入的候选。',
    sources: [{ kind: 'manual', actor: 'star', label: '星星手动加入' }],
  }, 'star', 'star')
  assert.throws(() => memory.reviewMemoryCandidate(bad.id, 'approve', 'star', ['missing-family']), /family not found/)
  assert.equal(memory.listMemoryCandidates().find(item => item.id === bad.id)?.status, 'pending_star')

  const header = readFileSync(path.join(root, 'star-memory', 'star-memory.sqlite')).subarray(0, 16).toString()
  assert.equal(header, 'SQLite format 3\0')
  assert.equal(memory.getStarMemoryStatus().memories, memoriesBeforeInvalidReview)
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

test('formal memory recycle restores evidence and family links before purging at 24 hours', async () => {
  const family = memory.createMemoryFamily({ name: '回收测试' }, 'fire')
  const approved = memory.reviewMemoryCandidate(memory.createMemoryCandidate({
    type: 'shared_event',
    summary: '一条可以完整恢复的正式记忆。',
    details: '必要细节也应恢复。',
    sources: [{ kind: 'manual', actor: 'star', label: '星星手动加入', excerpt: '原始依据' }],
    quotes: [{ actor: 'fire', text: '请把证据一起保存。' }],
    familyIds: [family.id],
  }, 'star').id, 'approve', 'star').memory!

  const recycled = memory.recycleCanonicalMemory(approved.id, 'fire', '2026-10-06T10:00:00.000Z')
  assert.equal(memory.listCanonicalMemories().some(item => item.id === approved.id), false)
  assert.equal(memory.getMemoryFamily(family.id)?.memories.length, 0)
  assert.throws(() => memory.resolveMemorySources(approved.id), /memory not found/)
  assert.equal(memory.listRecycledMemories('2026-10-06T11:00:00.000Z')[0].id, recycled.id)

  const restored = memory.restoreCanonicalMemory(recycled.id, 'fire')
  assert.equal(restored.details, '必要细节也应恢复。')
  assert.equal(restored.sources[0].excerpt, '原始依据')
  assert.equal(restored.quotes?.[0].text, '请把证据一起保存。')
  assert.deepEqual(memory.getMemoryFamily(family.id)?.memories.map(item => item.id), [approved.id])

  memory.setCanonicalMemoryLock(approved.id, true, 'star')
  assert.throws(() => memory.recycleCanonicalMemory(approved.id, 'fire'), /locked by star/)
  memory.setCanonicalMemoryLock(approved.id, false, 'star')
  const recycledAgain = memory.recycleCanonicalMemory(approved.id, 'star', '2099-10-06T12:00:00.000Z')
  const toolTrash = JSON.parse(await runtime.executeRegisteredToolHandler('manage_formal_memory', { action: 'list_trash' }))
  assert.equal(toolTrash.some((item: any) => item.id === recycledAgain.id), true)
  assert.equal(memory.purgeExpiredMemoryRecycleBin('2099-10-07T11:59:59.000Z'), 0)
  assert.equal(memory.purgeExpiredMemoryRecycleBin('2099-10-07T12:00:00.000Z'), 1)
  assert.throws(() => memory.restoreCanonicalMemory(recycledAgain.id, 'star'), /not found/)
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
  assert.equal(recalled.hits.some((item: any) => item.id === short.working.id && item.memory_kind === 'short_term'), true)
})

test('mixed recall separates reliable, fuzzy, current, family, and missing results', () => {
  const family = memory.createMemoryFamily({ name: '植物照护', summary: '阳台花草的长期照料过程。' }, 'star')
  const shared = memory.reviewMemoryCandidate(memory.createMemoryCandidate({
    type: 'shared_event',
    summary: '小火和星星一起规划了长期记忆系统。',
    quotes: [{ actor: 'fire', text: '青色彗星暗号。' }],
    sources: [{ kind: 'manual', actor: 'star', label: '星星手动加入' }],
    importance: 9,
  }, 'star').id, 'approve', 'star').memory!
  const plant = memory.reviewMemoryCandidate(memory.createMemoryCandidate({
    type: 'shared_event',
    summary: '第一次换盆完成。',
    sources: [{ kind: 'manual', actor: 'star', label: '星星手动加入' }],
    familyIds: [family.id],
  }, 'star').id, 'approve', 'star').memory!
  memory.reviewMemoryCandidate(memory.createMemoryCandidate({
    type: 'durable_fact',
    summary: '小火当前使用银色火箭杯。',
    validTo: '2020-01-01T00:00:00.000Z',
    sources: [{ kind: 'manual', actor: 'star', label: '星星手动加入' }],
  }, 'star').id, 'approve', 'star')

  const exact = memory.recallStarMemoryBundle('第一次说青色彗星暗号')
  assert.equal(exact.status, 'reliable')
  assert.equal(exact.query_type, 'exact')
  assert.match(exact.certainty_note || '', /不能单独证明/)
  assert.equal(exact.hits[0].id, shared.id)

  const paraphrase = memory.recallStarMemoryBundle('我们一起规划长期记忆库的经历')
  assert.notEqual(paraphrase.status, 'not_found')
  assert.equal(paraphrase.hits.some(item => item.id === shared.id), true)

  const byFamily = memory.recallStarMemoryBundle('阳台花草照料')
  assert.equal(byFamily.hits.some(item => item.id === plant.id && item.recall_reason === '家族摘要相关'), true)

  const current = memory.recallStarMemoryBundle('现在还使用银色火箭杯吗')
  assert.equal(current.query_type, 'current')
  assert.equal(current.hits.some(item => item.summary.includes('银色火箭杯')), false)

  const missing = memory.recallStarMemoryBundle('紫金海豚玻璃城堡')
  assert.equal(missing.status, 'not_found')
  assert.deepEqual(missing.hits, [])
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

test('pending-fire reminder is silent without candidates and repeats only after 24 hours', () => {
  const first = memory.claimPendingFireReminder('2026-10-20T10:00:00.000Z')
  assert.ok(first)
  assert.equal(first!.count >= 1, true)
  assert.equal(memory.claimPendingFireReminder('2026-10-20T10:30:00.000Z'), null)
  assert.equal(memory.finishPendingFireReminder(first!.attemptedAt, false, '2026-10-20T10:30:00.000Z'), true)
  assert.equal(memory.claimPendingFireReminder('2026-10-20T10:59:59.000Z'), null)

  const retry = memory.claimPendingFireReminder('2026-10-20T11:00:00.000Z')!
  assert.ok(retry)
  assert.equal(memory.finishPendingFireReminder(retry.attemptedAt, true, '2026-10-20T11:00:00.000Z'), true)
  assert.equal(memory.claimPendingFireReminder('2026-10-21T10:59:59.000Z'), null)
  assert.ok(memory.claimPendingFireReminder('2026-10-21T11:00:00.000Z'))

  memory.listMemoryCandidates('pending_fire').forEach(candidate => memory.reviewMemoryCandidate(candidate.id, 'reject', 'star'))
  assert.equal(memory.claimPendingFireReminder('2026-10-22T12:00:00.000Z'), null)
})
