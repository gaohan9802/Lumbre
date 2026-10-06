import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getDataDir } from './data/config'
import { readChatSession } from './data/repositories/chat'
import { resolveDataPath } from './data/safe-path'

export type MemoryActor = 'fire' | 'star' | 'system'
export type MemoryType = 'shared_event' | 'durable_fact' | 'agreement' | 'current_state' | 'observation' | 'self_event' | 'unresolved'
export type CandidateStatus = 'pending_star' | 'pending_fire' | 'observing' | 'approved' | 'rejected'
export type FamilyStatus = 'active' | 'paused' | 'ended' | 'archived'

export interface SourceRef {
  kind: 'chat' | 'manual' | 'image' | 'journal' | 'health'
  actor: MemoryActor
  sessionId?: string
  messageIds?: string[]
  label?: string
  excerpt?: string
}

export interface MemoryDraft {
  type: MemoryType
  summary: string
  details?: string
  whyImportant?: string
  sources: SourceRef[]
  quotes?: { actor: 'fire' | 'star'; text: string }[]
  starFeeling?: string
  currentUnderstanding?: string
  occurredAt?: string
  validFrom?: string
  validTo?: string
  importance?: number
  inference?: boolean
  confidence?: number
  locked?: boolean
}

export interface MemoryCandidate extends MemoryDraft {
  id: string
  status: CandidateStatus
  owner: 'fire' | 'star'
  createdBy: MemoryActor
  createdAt: string
  updatedAt: string
  memoryId?: string
  suggestedFamilyIds: string[]
  lockOwner?: 'fire' | 'star'
}

export interface CanonicalMemory extends MemoryDraft {
  id: string
  createdBy: MemoryActor
  approvedBy: 'fire' | 'star'
  createdAt: string
  status: 'active'
  lockOwner?: 'fire' | 'star'
}

export interface MemoryFamily {
  id: string
  name: string
  title?: string
  summary?: string
  status: FamilyStatus
  parentId?: string
  locked: boolean
  createdBy: 'fire' | 'star'
  createdAt: string
  updatedAt: string
}

export interface FamilyMembership {
  familyId: string
  memoryId: string
  role: 'key_event' | 'key_fact' | 'member' | 'unresolved'
  reason?: string
  addedBy: 'fire' | 'star'
  createdAt: string
}

type Row = Record<string, any>
type Target = 'candidate' | 'memory'

const DB_FILE = resolveDataPath(getDataDir(), 'star-memory', 'star-memory.sqlite')
const MEMORY_TYPES = new Set<MemoryType>(['shared_event', 'durable_fact', 'agreement', 'current_state', 'observation', 'self_event', 'unresolved'])
const FAMILY_STATUSES = new Set<FamilyStatus>(['active', 'paused', 'ended', 'archived'])
let database: Database.Database | undefined

function getDb(): Database.Database {
  if (database) return database
  mkdirSync(path.dirname(DB_FILE), { recursive: true })
  database = new Database(DB_FILE)
  database.pragma('foreign_keys = ON')
  database.pragma('busy_timeout = 5000')
  database.exec(`
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, summary TEXT NOT NULL, details TEXT,
      why_important TEXT, star_feeling TEXT, current_understanding TEXT,
      occurred_at TEXT, valid_from TEXT, valid_to TEXT,
      importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 10),
      inference INTEGER NOT NULL DEFAULT 0 CHECK (inference IN (0, 1)),
      confidence REAL CHECK (confidence BETWEEN 0 AND 1),
      locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
      lock_owner TEXT CHECK (lock_owner IN ('fire', 'star')),
      status TEXT NOT NULL, owner TEXT NOT NULL, created_by TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, memory_id TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, summary TEXT NOT NULL, details TEXT,
      why_important TEXT, star_feeling TEXT, current_understanding TEXT,
      occurred_at TEXT, valid_from TEXT, valid_to TEXT,
      importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 10),
      inference INTEGER NOT NULL DEFAULT 0 CHECK (inference IN (0, 1)),
      confidence REAL CHECK (confidence BETWEEN 0 AND 1),
      locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
      lock_owner TEXT CHECK (lock_owner IN ('fire', 'star')),
      created_by TEXT NOT NULL, approved_by TEXT NOT NULL, created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE IF NOT EXISTS source_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK (target_type IN ('candidate', 'memory')),
      target_id TEXT NOT NULL, kind TEXT NOT NULL, actor TEXT NOT NULL,
      session_id TEXT, label TEXT, excerpt TEXT, position INTEGER NOT NULL,
      UNIQUE (target_type, target_id, position)
    );
    CREATE TABLE IF NOT EXISTS source_messages (
      source_id INTEGER NOT NULL REFERENCES source_refs(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL, position INTEGER NOT NULL,
      PRIMARY KEY (source_id, message_id)
    );
    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK (target_type IN ('candidate', 'memory')),
      target_id TEXT NOT NULL, actor TEXT NOT NULL, text TEXT NOT NULL,
      position INTEGER NOT NULL, UNIQUE (target_type, target_id, position)
    );
    CREATE TABLE IF NOT EXISTS families (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, title TEXT, summary TEXT,
      status TEXT NOT NULL, parent_id TEXT REFERENCES families(id),
      locked INTEGER NOT NULL DEFAULT 0 CHECK (locked IN (0, 1)),
      created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS families_name_level
      ON families(COALESCE(parent_id, ''), name COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS candidate_family_suggestions (
      candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      family_id TEXT NOT NULL REFERENCES families(id),
      PRIMARY KEY (candidate_id, family_id)
    );
    CREATE TABLE IF NOT EXISTS family_memberships (
      family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      role TEXT NOT NULL, reason TEXT, added_by TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY (family_id, memory_id)
    );
    CREATE TABLE IF NOT EXISTS changes (
      id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
      target_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
  `)
  const hasColumn = (table: string, column: string) => (database!.pragma(`table_info(${table})`) as Row[]).some(row => row.name === column)
  if (!hasColumn('candidates', 'lock_owner')) database.exec("ALTER TABLE candidates ADD COLUMN lock_owner TEXT CHECK (lock_owner IN ('fire', 'star'))")
  if (!hasColumn('memories', 'lock_owner')) database.exec("ALTER TABLE memories ADD COLUMN lock_owner TEXT CHECK (lock_owner IN ('fire', 'star'))")
  database.exec(`
    UPDATE candidates SET lock_owner = 'fire'
      WHERE locked = 1 AND lock_owner IS NULL AND created_by = 'fire' AND EXISTS (
        SELECT 1 FROM source_refs WHERE target_type = 'candidate' AND target_id = candidates.id AND kind = 'manual' AND actor = 'fire'
      );
    UPDATE candidates SET lock_owner = created_by
      WHERE locked = 1 AND lock_owner IS NULL AND created_by IN ('fire', 'star');
    UPDATE memories SET lock_owner = 'fire'
      WHERE locked = 1 AND lock_owner IS NULL AND created_by = 'fire' AND EXISTS (
        SELECT 1 FROM source_refs WHERE target_type = 'memory' AND target_id = memories.id AND kind = 'manual' AND actor = 'fire'
      );
    UPDATE memories SET lock_owner = created_by
      WHERE locked = 1 AND lock_owner IS NULL AND created_by IN ('fire', 'star');
  `)
  database.pragma('user_version = 2')
  return database
}

export function closeStarMemoryDatabase(): void {
  database?.close()
  database = undefined
}

function text(value: unknown, name: string, max: number, required = false): string | undefined {
  const result = typeof value === 'string' ? value.trim() : ''
  if (required && !result) throw new Error(`${name} is required`)
  if (result.length > max) throw new Error(`${name} is too long`)
  return result || undefined
}

function iso(value: unknown, name: string): string | undefined {
  const result = text(value, name, 40)
  if (!result) return undefined
  if (!Number.isFinite(new Date(result).getTime())) throw new Error(`${name} must be an ISO date`)
  return new Date(result).toISOString()
}

function actor(value: unknown, allowSystem = true): MemoryActor {
  if (value === 'fire' || value === 'star' || (allowSystem && value === 'system')) return value
  throw new Error('actor is invalid')
}

function reviewer(value: unknown): 'fire' | 'star' {
  if (value === 'fire' || value === 'star') return value
  throw new Error('reviewer is invalid')
}

function sources(value: unknown): SourceRef[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 20) throw new Error('at least one source is required')
  return value.map((raw): SourceRef => {
    if (!raw || typeof raw !== 'object') throw new Error('source is invalid')
    const item = raw as SourceRef
    if (!['chat', 'manual', 'image', 'journal', 'health'].includes(item.kind)) throw new Error('source kind is invalid')
    const sourceActor = actor(item.actor)
    const sessionId = text(item.sessionId, 'source.sessionId', 200)
    const messageIds = Array.isArray(item.messageIds)
      ? Array.from(new Set(item.messageIds.map(id => text(id, 'source.messageId', 200, true)!))).slice(0, 40)
      : undefined
    const label = text(item.label, 'source.label', 200)
    const excerpt = text(item.excerpt, 'source.excerpt', 2_000)
    if (item.kind === 'chat' && (!sessionId || !messageIds?.length)) throw new Error('chat source needs sessionId and messageIds')
    if (item.kind === 'manual' && !label) throw new Error('manual source needs a label')
    return { kind: item.kind, actor: sourceActor, sessionId, messageIds, label, excerpt }
  })
}

function draft(value: unknown): MemoryDraft {
  if (!value || typeof value !== 'object') throw new Error('memory draft is required')
  const input = value as MemoryDraft
  if (!MEMORY_TYPES.has(input.type)) throw new Error('memory type is invalid')
  const importance = input.importance === undefined ? 5 : Number(input.importance)
  if (!Number.isInteger(importance) || importance < 1 || importance > 10) throw new Error('importance must be an integer from 1 to 10')
  const confidence = input.confidence === undefined ? undefined : Number(input.confidence)
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) throw new Error('confidence must be from 0 to 1')
  const validFrom = iso(input.validFrom, 'validFrom')
  const validTo = iso(input.validTo, 'validTo')
  if (validFrom && validTo && validFrom > validTo) throw new Error('validTo must not be before validFrom')
  const quotes = Array.isArray(input.quotes) ? input.quotes.slice(0, 12).map(item => {
    if (!item || !['fire', 'star'].includes(item.actor)) throw new Error('quote actor is invalid')
    return { actor: item.actor, text: text(item.text, 'quote', 1_000, true)! }
  }) : []
  return {
    type: input.type,
    summary: text(input.summary, 'summary', 1_000, true)!,
    details: text(input.details, 'details', 6_000),
    whyImportant: text(input.whyImportant, 'whyImportant', 1_000),
    sources: sources(input.sources),
    quotes,
    starFeeling: text(input.starFeeling, 'starFeeling', 1_500),
    currentUnderstanding: text(input.currentUnderstanding, 'currentUnderstanding', 1_500),
    occurredAt: iso(input.occurredAt, 'occurredAt'),
    validFrom,
    validTo,
    importance,
    inference: !!input.inference,
    confidence,
    locked: !!input.locked,
  }
}

function draftValues(value: MemoryDraft): unknown[] {
  return [value.type, value.summary, value.details, value.whyImportant, value.starFeeling, value.currentUnderstanding,
    value.occurredAt, value.validFrom, value.validTo, value.importance || 5, value.inference ? 1 : 0,
    value.confidence, value.locked ? 1 : 0]
}

function loadSources(target: Target, id: string): SourceRef[] {
  const db = getDb()
  return (db.prepare('SELECT * FROM source_refs WHERE target_type = ? AND target_id = ? ORDER BY position').all(target, id) as Row[])
    .map(row => ({
      kind: row.kind,
      actor: row.actor,
      sessionId: row.session_id || undefined,
      messageIds: (db.prepare('SELECT message_id FROM source_messages WHERE source_id = ? ORDER BY position').all(row.id) as Row[]).map(item => item.message_id),
      label: row.label || undefined,
      excerpt: row.excerpt || undefined,
    }))
}

function loadQuotes(target: Target, id: string): { actor: 'fire' | 'star'; text: string }[] {
  return (getDb().prepare('SELECT actor, text FROM quotes WHERE target_type = ? AND target_id = ? ORDER BY position').all(target, id) as Row[])
    .map(row => ({ actor: row.actor, text: row.text }))
}

function writeSources(target: Target, id: string, values: SourceRef[]): void {
  const db = getDb()
  const insertSource = db.prepare('INSERT INTO source_refs (target_type, target_id, kind, actor, session_id, label, excerpt, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const insertMessage = db.prepare('INSERT INTO source_messages (source_id, message_id, position) VALUES (?, ?, ?)')
  values.forEach((source, position) => {
    const info = insertSource.run(target, id, source.kind, source.actor, source.sessionId, source.label, source.excerpt, position)
    source.messageIds?.forEach((messageId, messagePosition) => insertMessage.run(info.lastInsertRowid, messageId, messagePosition))
  })
}

function writeQuotes(target: Target, id: string, values: MemoryDraft['quotes']): void {
  const insert = getDb().prepare('INSERT INTO quotes (target_type, target_id, actor, text, position) VALUES (?, ?, ?, ?, ?)')
  values?.forEach((quote, position) => insert.run(target, id, quote.actor, quote.text, position))
}

function common(row: Row, target: Target): MemoryDraft {
  return {
    type: row.type,
    summary: row.summary,
    details: row.details || undefined,
    whyImportant: row.why_important || undefined,
    sources: loadSources(target, row.id),
    quotes: loadQuotes(target, row.id),
    starFeeling: row.star_feeling || undefined,
    currentUnderstanding: row.current_understanding || undefined,
    occurredAt: row.occurred_at || undefined,
    validFrom: row.valid_from || undefined,
    validTo: row.valid_to || undefined,
    importance: row.importance,
    inference: !!row.inference,
    confidence: row.confidence ?? undefined,
    locked: !!row.locked,
  }
}

function candidateFromRow(row: Row): MemoryCandidate {
  const suggestedFamilyIds = (getDb().prepare('SELECT family_id FROM candidate_family_suggestions WHERE candidate_id = ?').all(row.id) as Row[]).map(item => item.family_id)
  return { ...common(row, 'candidate'), id: row.id, status: row.status, owner: row.owner, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at, memoryId: row.memory_id || undefined, suggestedFamilyIds, lockOwner: row.lock_owner || undefined }
}

function memoryFromRow(row: Row): CanonicalMemory {
  return { ...common(row, 'memory'), id: row.id, createdBy: row.created_by, approvedBy: row.approved_by, createdAt: row.created_at, status: 'active', lockOwner: row.lock_owner || undefined }
}

function familyFromRow(row: Row): MemoryFamily {
  return { id: row.id, name: row.name, title: row.title || undefined, summary: row.summary || undefined, status: row.status, parentId: row.parent_id || undefined, locked: !!row.locked, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at }
}

function recordChange(actorValue: MemoryActor, action: string, targetId: string, now: string): void {
  getDb().prepare('INSERT INTO changes (id, actor, action, target_id, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), actorValue, action, targetId, now)
}

export function getStarMemoryStatus() {
  const db = getDb()
  const count = (sql: string) => (db.prepare(sql).get() as Row).count as number
  return {
    version: Number(db.pragma('user_version', { simple: true })),
    candidates: count('SELECT COUNT(*) AS count FROM candidates'),
    pendingStar: count("SELECT COUNT(*) AS count FROM candidates WHERE status = 'pending_star'"),
    pendingFire: count("SELECT COUNT(*) AS count FROM candidates WHERE status = 'pending_fire'"),
    memories: count('SELECT COUNT(*) AS count FROM memories'),
    families: count('SELECT COUNT(*) AS count FROM families'),
  }
}

export function listMemoryCandidates(status?: CandidateStatus): MemoryCandidate[] {
  const rows = status
    ? getDb().prepare('SELECT * FROM candidates WHERE status = ? ORDER BY created_at DESC').all(status)
    : getDb().prepare('SELECT * FROM candidates ORDER BY created_at DESC').all()
  return (rows as Row[]).map(candidateFromRow)
}

export function listCanonicalMemories(): Array<CanonicalMemory & { familyIds: string[] }> {
  return (getDb().prepare('SELECT * FROM memories ORDER BY COALESCE(occurred_at, created_at) DESC').all() as Row[]).map(row => ({
    ...memoryFromRow(row),
    familyIds: (getDb().prepare('SELECT family_id FROM family_memberships WHERE memory_id = ? ORDER BY created_at').all(row.id) as Row[]).map(item => item.family_id),
  }))
}

export function createMemoryCandidate(input: unknown, createdByValue: unknown, ownerValue: unknown = 'star'): MemoryCandidate {
  const createdBy = actor(createdByValue)
  const owner = reviewer(ownerValue)
  const value = draft(input)
  const raw = input as MemoryDraft & { familyIds?: unknown[] }
  const suggestedFamilyIds = Array.isArray(raw.familyIds) ? Array.from(new Set(raw.familyIds.map(id => text(id, 'familyId', 100, true)!))) : []
  const now = new Date().toISOString()
  const id = randomUUID()
  getDb().transaction(() => {
    for (const familyId of suggestedFamilyIds) {
      if (!getDb().prepare('SELECT 1 FROM families WHERE id = ?').get(familyId)) throw new Error(`family not found: ${familyId}`)
    }
    getDb().prepare(`INSERT INTO candidates
      (id, type, summary, details, why_important, star_feeling, current_understanding, occurred_at, valid_from, valid_to, importance, inference, confidence, locked, lock_owner, status, owner, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, ...draftValues(value), value.locked && createdBy !== 'system' ? createdBy : undefined, owner === 'fire' ? 'pending_fire' : 'pending_star', owner, createdBy, now, now)
    writeSources('candidate', id, value.sources)
    writeQuotes('candidate', id, value.quotes)
    const suggest = getDb().prepare('INSERT INTO candidate_family_suggestions (candidate_id, family_id) VALUES (?, ?)')
    suggestedFamilyIds.forEach(familyId => suggest.run(id, familyId))
    recordChange(createdBy, 'candidate.created', id, now)
  })()
  return candidateFromRow(getDb().prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Row)
}

function familyDepth(parentId?: string): number {
  if (!parentId) return 1
  const seen = new Set<string>()
  let currentId: string | undefined = parentId
  let depth = 1
  while (currentId) {
    if (seen.has(currentId)) throw new Error('family hierarchy has a cycle')
    seen.add(currentId)
    const row = getDb().prepare('SELECT parent_id FROM families WHERE id = ?').get(currentId) as Row | undefined
    if (!row) throw new Error('parent family not found')
    depth += 1
    currentId = row.parent_id || undefined
  }
  return depth
}

export function createMemoryFamily(input: unknown, actorValue: unknown): MemoryFamily {
  if (!input || typeof input !== 'object') throw new Error('family is required')
  const raw = input as Partial<MemoryFamily>
  const createdBy = reviewer(actorValue)
  const name = text(raw.name, 'family.name', 120, true)!
  const title = text(raw.title, 'family.title', 200)
  const summary = text(raw.summary, 'family.summary', 2_000)
  const parentId = text(raw.parentId, 'family.parentId', 100)
  const status = raw.status || 'active'
  if (!FAMILY_STATUSES.has(status)) throw new Error('family status is invalid')
  if (familyDepth(parentId) > 3) throw new Error('family nesting cannot exceed three levels')
  const now = new Date().toISOString()
  const id = randomUUID()
  try {
    getDb().transaction(() => {
      getDb().prepare('INSERT INTO families (id, name, title, summary, status, parent_id, locked, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, name, title, summary, status, parentId, raw.locked ? 1 : 0, createdBy, now, now)
      recordChange(createdBy, 'family.created', id, now)
    })()
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw new Error('family name already exists at this level')
    throw error
  }
  return familyFromRow(getDb().prepare('SELECT * FROM families WHERE id = ?').get(id) as Row)
}

export function listMemoryFamilies(): Array<MemoryFamily & { memberCount: number }> {
  return (getDb().prepare(`SELECT families.*, COUNT(family_memberships.memory_id) AS member_count
    FROM families LEFT JOIN family_memberships ON family_memberships.family_id = families.id
    GROUP BY families.id ORDER BY families.name COLLATE NOCASE`).all() as Row[])
    .map(row => ({ ...familyFromRow(row), memberCount: row.member_count }))
}

export function getMemoryFamily(id: string) {
  const row = getDb().prepare('SELECT * FROM families WHERE id = ?').get(id) as Row | undefined
  if (!row) return null
  const memberships = (getDb().prepare('SELECT * FROM family_memberships WHERE family_id = ? ORDER BY created_at').all(id) as Row[]).map(item => ({
    familyId: item.family_id, memoryId: item.memory_id, role: item.role, reason: item.reason || undefined, addedBy: item.added_by, createdAt: item.created_at,
  })) as FamilyMembership[]
  const memories = memberships.map(link => getDb().prepare('SELECT * FROM memories WHERE id = ?').get(link.memoryId) as Row).filter(Boolean).map(memoryFromRow)
  return { ...familyFromRow(row), children: (getDb().prepare('SELECT * FROM families WHERE parent_id = ?').all(id) as Row[]).map(familyFromRow), memberships, memories }
}

export type CandidateDecision = 'approve' | 'reject' | 'observe' | 'assign_fire' | 'assign_star'

export function reviewMemoryCandidate(idValue: unknown, decision: CandidateDecision, reviewerValue: unknown, familyIdsValue?: unknown) {
  const id = text(idValue, 'candidate id', 100, true)!
  const approvedBy = reviewer(reviewerValue)
  if (!new Set<CandidateDecision>(['approve', 'reject', 'observe', 'assign_fire', 'assign_star']).has(decision)) throw new Error('candidate decision is invalid')
  return getDb().transaction(() => {
    const row = getDb().prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error('candidate not found')
    const current = candidateFromRow(row)
    if (current.status === 'approved' || current.status === 'rejected') throw new Error('candidate is already final')
    const now = new Date().toISOString()
    if (decision !== 'approve') {
      const status = decision === 'reject' ? 'rejected' : decision === 'observe' ? 'observing' : decision === 'assign_fire' ? 'pending_fire' : 'pending_star'
      const owner = decision === 'assign_fire' ? 'fire' : decision === 'assign_star' ? 'star' : current.owner
      getDb().prepare('UPDATE candidates SET status = ?, owner = ?, updated_at = ? WHERE id = ?').run(status, owner, now, id)
      recordChange(approvedBy, `candidate.${decision}`, id, now)
      return { candidate: candidateFromRow(getDb().prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Row) }
    }

    const requestedIds = Array.isArray(familyIdsValue)
      ? Array.from(new Set(familyIdsValue.map(value => text(value, 'familyId', 100, true)!)))
      : current.suggestedFamilyIds
    for (const familyId of requestedIds) {
      if (!getDb().prepare('SELECT 1 FROM families WHERE id = ?').get(familyId)) throw new Error(`family not found: ${familyId}`)
    }
    const memoryId = randomUUID()
    const manualByFire = current.createdBy === 'fire' && current.sources.some(source => source.kind === 'manual' && source.actor === 'fire')
    const lockOwner = manualByFire ? 'fire' : current.locked ? (current.lockOwner || (current.createdBy === 'system' ? approvedBy : current.createdBy)) : undefined
    const locked = !!lockOwner
    getDb().prepare(`INSERT INTO memories
      (id, type, summary, details, why_important, star_feeling, current_understanding, occurred_at, valid_from, valid_to, importance, inference, confidence, locked, lock_owner, created_by, approved_by, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
      .run(memoryId, ...draftValues({ ...current, locked }), lockOwner, current.createdBy, approvedBy, now)
    writeSources('memory', memoryId, current.sources)
    writeQuotes('memory', memoryId, current.quotes)
    getDb().prepare("UPDATE candidates SET status = 'approved', memory_id = ?, updated_at = ? WHERE id = ?").run(memoryId, now, id)
    const addMembership = getDb().prepare('INSERT INTO family_memberships (family_id, memory_id, role, added_by, created_at) VALUES (?, ?, ?, ?, ?)')
    requestedIds.forEach(familyId => addMembership.run(familyId, memoryId,
      current.type === 'shared_event' || current.type === 'self_event' ? 'key_event' : current.type === 'unresolved' ? 'unresolved' : 'member', approvedBy, now))
    recordChange(approvedBy, 'candidate.approved', id, now)
    return {
      candidate: candidateFromRow(getDb().prepare('SELECT * FROM candidates WHERE id = ?').get(id) as Row),
      memory: memoryFromRow(getDb().prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as Row),
    }
  })()
}

function writableMemory(id: string, actorValue: 'fire' | 'star'): Row {
  const row = getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id) as Row | undefined
  if (!row) throw new Error('memory not found')
  if (row.lock_owner && row.lock_owner !== actorValue) throw new Error(`memory is locked by ${row.lock_owner}`)
  return row
}

export function updateCanonicalMemory(idValue: unknown, patchValue: unknown, actorValue: unknown): CanonicalMemory {
  const id = text(idValue, 'memory id', 100, true)!
  const updatedBy = reviewer(actorValue)
  if (!patchValue || typeof patchValue !== 'object') throw new Error('memory patch is required')
  return getDb().transaction(() => {
    const current = memoryFromRow(writableMemory(id, updatedBy))
    const next = draft({ ...current, ...(patchValue as object), sources: current.sources, quotes: current.quotes, locked: current.locked })
    getDb().prepare(`UPDATE memories SET type = ?, summary = ?, details = ?, why_important = ?, star_feeling = ?, current_understanding = ?,
      occurred_at = ?, valid_from = ?, valid_to = ?, importance = ?, inference = ?, confidence = ? WHERE id = ?`)
      .run(...draftValues({ ...next, locked: false }).slice(0, 12), id)
    recordChange(updatedBy, 'memory.updated', id, new Date().toISOString())
    return memoryFromRow(getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id) as Row)
  })()
}

export function setCanonicalMemoryLock(idValue: unknown, lockedValue: unknown, actorValue: unknown): CanonicalMemory {
  const id = text(idValue, 'memory id', 100, true)!
  const lockActor = reviewer(actorValue)
  if (typeof lockedValue !== 'boolean') throw new Error('locked must be a boolean')
  const locked = lockedValue
  return getDb().transaction(() => {
    writableMemory(id, lockActor)
    getDb().prepare('UPDATE memories SET locked = ?, lock_owner = ? WHERE id = ?').run(locked ? 1 : 0, locked ? lockActor : null, id)
    recordChange(lockActor, locked ? 'memory.locked' : 'memory.unlocked', id, new Date().toISOString())
    return memoryFromRow(getDb().prepare('SELECT * FROM memories WHERE id = ?').get(id) as Row)
  })()
}

function normalized(value: string): string {
  return value.toLocaleLowerCase('zh-CN').replace(/[\s!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？、；：“”‘’（）【】《》…—]+/g, '')
}

function bigrams(value: string): Set<string> {
  const clean = normalized(value)
  const result = new Set<string>()
  if (clean.length < 2) { if (clean) result.add(clean); return result }
  for (let index = 0; index < clean.length - 1; index++) result.add(clean.slice(index, index + 2))
  return result
}

function relevance(haystack: string, query: string): number {
  const textValue = normalized(haystack)
  const queryValue = normalized(query)
  if (!queryValue) return 0
  if (textValue.includes(queryValue)) return 100
  const queryGrams = bigrams(queryValue)
  if (!queryGrams.size) return 0
  const textGrams = bigrams(textValue)
  let matches = 0
  queryGrams.forEach(gram => { if (textGrams.has(gram)) matches += 1 })
  return (matches / queryGrams.size) * 70
}

export function recallStarMemories(queryValue: unknown, limitValue: unknown = 10) {
  const query = text(queryValue, 'query', 500, true)!
  const limit = Math.max(1, Math.min(20, Number(limitValue) || 10))
  const memories = (getDb().prepare('SELECT * FROM memories').all() as Row[]).map(memoryFromRow)
  const families = (getDb().prepare('SELECT * FROM families').all() as Row[]).map(familyFromRow)
  const familyScores = new Map(families.map(family => [family.id, relevance(`${family.name} ${family.title || ''} ${family.summary || ''}`, query)]))
  const now = new Date().toISOString()
  return memories.map(memory => {
    const familyIds = (getDb().prepare('SELECT family_id FROM family_memberships WHERE memory_id = ?').all(memory.id) as Row[]).map(item => item.family_id)
    const linkedFamilies = familyIds.map(id => families.find(item => item.id === id)).filter((item): item is MemoryFamily => !!item)
    const memoryText = [memory.summary, memory.details, memory.whyImportant, memory.currentUnderstanding, ...(memory.quotes || []).map(item => item.text)].filter(Boolean).join(' ')
    const direct = relevance(memoryText, query)
    const family = Math.max(0, ...linkedFamilies.map(item => familyScores.get(item.id) || 0)) * 0.85
    const base = Math.max(direct, family)
    const current = !memory.validTo || memory.validTo >= now
    const score = base > 0 ? base + (memory.importance || 5) * 2 + (current ? 10 : 0) : 0
    return { memory, families: linkedFamilies, score: Number(score.toFixed(2)), match: direct >= family ? 'memory' : 'family', current }
  }).filter(item => item.score >= 25).sort((a, b) => b.score - a.score).slice(0, limit)
}

export function resolveMemorySources(memoryIdValue: unknown) {
  const memoryId = text(memoryIdValue, 'memory id', 100, true)!
  const row = getDb().prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as Row | undefined
  if (!row) throw new Error('memory not found')
  return memoryFromRow(row).sources.map(source => {
    if (source.kind !== 'chat' || !source.sessionId) return { source, resolved: source.excerpt ? [{ content: source.excerpt }] : [] }
    const session = readChatSession(source.sessionId) as any
    const wanted = new Set(source.messageIds || [])
    const resolved = Array.isArray(session?.messages)
      ? session.messages.filter((message: any) => wanted.has(String(message?.id || ''))).map((message: any) => ({
        id: String(message.id), role: message.role, content: String(message.content || ''), timestamp: Number(message.timestamp) || 0,
      }))
      : []
    return { source, resolved, missing: resolved.length !== wanted.size }
  })
}
