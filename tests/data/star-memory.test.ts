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
let journal: typeof import('../../src/server/diary-store')
let runtime: typeof import('../../src/server/tool-runtime')
let brain: typeof import('../../src/server/brain')
let memoryRepository: typeof import('../../src/server/data/repositories/memory')
let route: typeof import('../../src/app/api/star-memory/route')
let NextRequest: typeof import('next/server').NextRequest

before(async () => {
  memory = await import('../../src/server/star-memory')
  chat = await import('../../src/server/data/repositories/chat')
  chatSync = await import('../../src/server/chat-sync')
  journal = await import('../../src/server/diary-store')
  runtime = await import('../../src/server/tool-runtime')
  brain = await import('../../src/server/brain')
  memoryRepository = await import('../../src/server/data/repositories/memory')
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

test('exports a restorable SQLite snapshot and readable whole or family documents', async () => {
  const family = memory.createMemoryFamily({ name: '导出测试家族', summary: '只属于这一组的档案。' }, 'fire')
  const child = memory.createMemoryFamily({ name: '导出测试子家族', parentId: family.id }, 'fire')
  const other = memory.createMemoryFamily({ name: '导出测试旁系' }, 'fire')
  const kept = memory.reviewMemoryCandidate(memory.createMemoryCandidate({
    type: 'shared_event', summary: '导出测试家族中的独特记忆。', details: '这段细节应进入阅读版。',
    starFeeling: '星星觉得这段共同经历很重要。', sources: [{ kind: 'manual', actor: 'fire', label: '小火手动加入' }], familyIds: [child.id],
  }, 'fire').id, 'approve', 'fire').memory!
  memory.reviewMemoryCandidate(memory.createMemoryCandidate({
    type: 'durable_fact', summary: '导出测试旁系中的独特记忆。',
    sources: [{ kind: 'manual', actor: 'fire', label: '小火手动加入' }], familyIds: [other.id],
  }, 'fire').id, 'approve', 'fire')
  journal.writeDiary({ date: '2026-10-07', author: 'star', title: '未公开导出测试', content: '这段正文只进机器备份。', visibility: 'private' })

  const snapshot = memory.serializeStarMemoryDatabase()
  assert.equal(snapshot.subarray(0, 16).toString(), 'SQLite format 3\0')
  const Database = (await import('better-sqlite3')).default
  const restored = new Database(snapshot)
  assert.equal((restored.prepare('SELECT COUNT(*) AS count FROM memories WHERE id = ?').get(kept.id) as { count: number }).count, 1)
  assert.match((restored.prepare('SELECT payload_json FROM star_diary_backup WHERE date = ?').get('2026-10-07') as { payload_json: string }).payload_json, /这段正文只进机器备份/)
  restored.close()

  const whole = memory.renderStarMemoryMarkdown(undefined, '2026-10-07T12:00:00.000Z')
  assert.match(whole, /# 星星记忆库导出/)
  assert.match(whole, /导出测试家族中的独特记忆/)
  assert.match(whole, /小火手动加入/)
  assert.doesNotMatch(whole, /这段正文只进机器备份/)
  const selected = memory.renderStarMemoryMarkdown(family.id, '2026-10-07T12:00:00.000Z')
  assert.match(selected, /家族“导出测试家族”及其子家族/)
  assert.match(selected, /导出测试家族中的独特记忆/)
  assert.match(selected, /星星当时的感受/)
  assert.doesNotMatch(selected, /导出测试旁系中的独特记忆/)

  const response = await route.GET(new NextRequest('http://localhost/api/star-memory?view=export&format=sqlite'))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/vnd.sqlite3')
  assert.match(response.headers.get('content-disposition') || '', /star-memory-\d{4}-\d{2}-\d{2}\.sqlite/)
  assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 16).toString(), 'SQLite format 3\0')
})

test('imports Ombre buckets once and sends feelings to the journal only after review', () => {
  const hard = brain.holdBucket('旧 Ombre 里的一条稳定内容。', { importance: 8, pinned: true })
  const feeling = brain.holdBucket('星星当时觉得一起做这件事很开心。', { importance: 7, feel: true })
  memoryRepository.writeMemoryBucket('abcdef123456', {
    id: 'abcdef123456', name: '旧格式感受', feel: true, content: '这是只有 feel:true 的旧格式桶。', created: '2026-01-02T12:00:00.000Z', importance: 6,
  })
  const imported = memory.importOmbreBuckets()
  assert.equal(imported.failed.length, 0)
  const candidates = memory.listMemoryCandidates()
  const hardCandidate = candidates.find(item => item.sources.some(source => source.kind === 'ombre' && source.sessionId === hard.id))!
  const feelingCandidate = candidates.find(item => item.sources.some(source => source.kind === 'ombre' && source.sessionId === feeling.id))!
  const legacyFeelingCandidate = candidates.find(item => item.sources.some(source => source.kind === 'ombre' && source.sessionId === 'abcdef123456'))!
  assert.equal(hardCandidate.status, 'pending_fire')
  assert.equal(feelingCandidate.type, 'self_event')
  assert.match(feelingCandidate.sources[0].label || '', /建议存入星星日记/)
  assert.equal(legacyFeelingCandidate.type, 'self_event')

  const edited = memory.updateMemoryCandidate(hardCandidate.id, { summary: '小火审核后修正的骨架。', familyIds: [] }, 'fire')
  assert.equal(edited.summary, '小火审核后修正的骨架。')
  const moved = memory.moveOmbreCandidateToJournal(feelingCandidate.id, 'fire')
  assert.equal(moved.candidate.status, 'journaled')
  assert.equal(moved.entry.author, 'star')
  assert.equal(moved.entry.visibility, 'public')
  assert.match(moved.entry.content, /很开心/)
  assert.equal(memory.importOmbreBuckets().created, 0)
})

test('favorites keep snapshots for memories, diaries, and chat replies without duplicates', () => {
  const memoryFavorite = memory.toggleFavorite({ kind: 'memory', targetKey: 'memory-1', title: '一条重要记忆', content: '记忆快照', metadata: { memoryId: 'memory-1' } }, 'fire')
  memory.toggleFavorite({ kind: 'diary', targetKey: 'star:2026-10-07:1200', title: '星星日记', content: '日记快照', metadata: { date: '2026-10-07' } }, 'fire')
  memory.toggleFavorite({ kind: 'chat', targetKey: 'session-1:message-1', title: '星星的回复', content: '聊天回复快照', metadata: { sessionId: 'session-1', messageId: 'message-1' } }, 'fire')
  assert.equal(memoryFavorite.favorited, true)
  assert.equal(memory.listFavorites().length, 3)
  assert.equal(memory.listFavorites('chat')[0].content, '聊天回复快照')
  assert.equal(memory.toggleFavorite({ kind: 'memory', targetKey: 'memory-1', title: '一条重要记忆', content: '记忆快照' }, 'fire').favorited, false)
  assert.equal(memory.listFavorites('memory').length, 0)
  assert.equal(memory.removeFavorite(memory.listFavorites('diary')[0].id, 'fire'), true)
  assert.equal(memory.listFavorites().length, 1)
})

test('a personal lock can only be changed or bypassed by its owner', async () => {
  const candidate = memory.createMemoryCandidate({
    type: 'self_event',
    summary: '星星决定长期保留的一段自我认识。',
    sources: [{ kind: 'manual', actor: 'star', label: '星星手动加入' }],
    locked: true,
  }, 'star', 'star')
  const approved = memory.reviewMemoryCandidate(candidate.id, 'approve', 'star').memory!
  const family = memory.createMemoryFamily({ name: '个人锁测试家族' }, 'star')
  const otherFamily = memory.createMemoryFamily({ name: '个人锁测试第二家族' }, 'fire')
  memory.setMemoryFamilyMembership(family.id, approved.id, 'member', '星星保留的节点', 'star')
  assert.equal(approved.lockOwner, 'star')
  assert.throws(() => memory.setCanonicalMemoryLock(approved.id, undefined, 'star'), /locked must be a boolean/)
  assert.throws(() => memory.updateCanonicalMemory(approved.id, { summary: '小火不能改。' }, 'fire'), /locked by star/)
  assert.throws(() => memory.setCanonicalMemoryLock(approved.id, false, 'fire'), /locked by star/)
  assert.throws(() => memory.removeMemoryFamilyMembership(family.id, approved.id, 'fire'), /locked by star/)
  assert.throws(() => memory.setMemoryFamilyMembership(otherFamily.id, approved.id, 'member', undefined, 'fire'), /locked by star/)
  assert.throws(() => memory.endMemoryFamily(family.id, 'fire'), /locked by star/)
  assert.throws(() => memory.recycleMemoryFamily(family.id, 'fire'), /locked by star/)
  assert.throws(() => memory.mergeMemoryFamilies(family.id, otherFamily.id, undefined, 'fire'), /locked by star/)
  assert.throws(() => memory.splitMemoryFamily(family.id, { name: '锁定记忆拆分结果' }, [approved.id], 'fire'), /locked by star/)
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

test('a conflict keeps both proposals pending and resolves to one canonical memory', async () => {
  const approved = memory.reviewMemoryCandidate(memory.createMemoryCandidate({
    type: 'durable_fact',
    summary: '当前正式版本。',
    sources: [{ kind: 'manual', actor: 'star', label: '星星手动加入' }],
  }, 'star').id, 'approve', 'star').memory!

  const conflict = memory.createMemoryConflict(approved.id, '建议修正版本。', '两种说法不一致', 'fire')
  assert.equal(conflict.currentSummary, '当前正式版本。')
  assert.equal(memory.getStarMemoryStatus().conflicts, 1)
  assert.throws(() => memory.createMemoryConflict(approved.id, '第三个版本。', undefined, 'star'), /already has an open conflict/)
  const kept = memory.resolveMemoryConflict(conflict.id, 'keep_current', 'fire')
  assert.equal(kept.memory.summary, '当前正式版本。')
  assert.equal(memory.listMemoryConflicts().length, 0)

  const flagged = JSON.parse(await runtime.executeRegisteredToolHandler('manage_formal_memory', {
    action: 'flag_conflict', memory_id: approved.id, proposed_summary: '最终准确版本。', reason: '星星再次核对',
  }))
  const resolved = await route.POST(new NextRequest('http://lumbre.test/api/star-memory', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'resolve_conflict', id: flagged.conflict.id, resolution: 'use_proposal' }),
  }))
  assert.equal(resolved.status, 200)
  assert.equal(memory.listCanonicalMemories().find(item => item.id === approved.id)?.summary, '最终准确版本。')

  memory.setCanonicalMemoryLock(approved.id, true, 'star')
  const lockedConflict = memory.createMemoryConflict(approved.id, '小火不能直接覆盖。', undefined, 'fire')
  assert.throws(() => memory.resolveMemoryConflict(lockedConflict.id, 'use_proposal', 'fire'), /locked by star/)
  assert.equal(memory.resolveMemoryConflict(lockedConflict.id, 'keep_current', 'fire').conflict.resolution, 'keep_current')
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
  const conflict = memory.createMemoryConflict(approved.id, '待确认的修正版。', '随记忆一起恢复', 'star')

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
  assert.equal(memory.listMemoryConflicts().find(item => item.id === conflict.id)?.proposedSummary, '待确认的修正版。')

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

test('mixed recall separates reliable, fuzzy, current, family, and missing results', async () => {
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

  const fuzzy = memory.recallStarMemoryBundle('青色甲乙丙丁戊')
  assert.equal(fuzzy.status, 'fuzzy')

  const byFamily = memory.recallStarMemoryBundle('阳台花草照料')
  assert.equal(byFamily.hits.some(item => item.id === plant.id && item.recall_reason === '家族摘要相关'), true)

  const current = memory.recallStarMemoryBundle('现在还使用银色火箭杯吗')
  assert.equal(current.query_type, 'current')
  assert.equal(current.hits.some(item => item.summary.includes('银色火箭杯')), false)

  const missing = memory.recallStarMemoryBundle('紫金海豚玻璃城堡')
  assert.equal(missing.status, 'not_found')
  assert.deepEqual(missing.hits, [])

  const context = memory.buildStarMemoryContext('我们一起规划长期记忆库的经历')
  assert.match(context, /新记忆库主动召回/)
  assert.match(context, /小火和星星一起规划了长期记忆系统/)
  assert.doesNotMatch(memory.buildStarMemoryContext('我们一起规划长期记忆库的经历', '小火和星星一起规划了长期记忆系统。'), /小火和星星一起规划了长期记忆系统/)
  assert.equal(memory.buildStarMemoryContext('青色甲乙丙丁戊'), '')

  const diary = journal.writeDiary({
    date: '2099-01-02', author: 'star', title: '雨后玻璃风铃', content: '我当时觉得雨后玻璃风铃像一段很安静的回音。', visibility: 'private',
  })
  const diaryContext = memory.buildStarMemoryContext('雨后玻璃风铃')
  assert.match(diaryContext, /星星日记低频联想/)
  assert.match(diaryContext, /不是小火说过的事实/)
  const observation = JSON.parse(await runtime.executeRegisteredToolHandler('remember', {
    type: 'observation', summary: '星星从风铃日记中产生了一个待小火确认的理解。', inference: true, confidence: 0.7,
    source_diary_date: diary.date, source_diary_time_id: diary.time_id, decision: 'ask_fire',
  }))
  assert.equal(observation.candidate.status, 'pending_fire')
  assert.equal(observation.candidate.sources.some((source: any) => source.kind === 'journal' && source.label.includes(diary.time_id)), true)
  assert.match(await runtime.executeRegisteredToolHandler('remember', {
    type: 'observation', summary: '不应绕过小火审核的日记推断。', inference: true,
    source_diary_date: diary.date, source_diary_time_id: diary.time_id, decision: 'approve',
  }), /reviewed by fire/)
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
