import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { getDataDir } from './data/config'
import { readChatSession } from './data/repositories/chat'
import { readDiaries } from './diary-store'
import { resolveDataPath } from './data/safe-path'

export type MemoryActor = 'fire' | 'star' | 'system'
export type MemoryType = 'shared_event' | 'durable_fact' | 'agreement' | 'current_state' | 'observation' | 'self_event' | 'unresolved'
export type CandidateStatus = 'pending_star' | 'pending_fire' | 'observing' | 'approved' | 'rejected'
export type FamilyStatus = 'active' | 'paused' | 'ended' | 'archived'
export type WorkingMemoryStatus = 'active' | 'due' | 'dismissed' | 'promoted'
export type MemoryConflictResolution = 'keep_current' | 'use_proposal'

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

export interface WorkingMemory extends MemoryDraft {
  id: string
  retentionDays: 1 | 7 | 14
  expiresAt: string
  status: WorkingMemoryStatus
  createdBy: 'fire' | 'star'
  createdAt: string
  updatedAt: string
  candidateId?: string
  suggestedFamilyIds: string[]
}

export interface MemoryFamily {
  id: string
  name: string
  title?: string
  summary?: string
  status: FamilyStatus
  parentId?: string
  locked: boolean
  lockOwner?: 'fire' | 'star'
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

export interface RecycledFamily {
  id: string
  familyId: string
  name: string
  deletedBy: 'fire' | 'star'
  deletedAt: string
  purgeAfter: string
}

export interface RecycledMemory {
  id: string
  memoryId: string
  summary: string
  deletedBy: 'fire' | 'star'
  deletedAt: string
  purgeAfter: string
}

export interface MemoryConflict {
  id: string
  memoryId: string
  currentSummary: string
  proposedSummary: string
  reason?: string
  status: 'open' | 'resolved'
  resolution?: MemoryConflictResolution
  createdBy: 'fire' | 'star'
  createdAt: string
  resolvedBy?: 'fire' | 'star'
  resolvedAt?: string
}

type Row = Record<string, any>
type Target = 'candidate' | 'memory'

const DB_FILE = resolveDataPath(getDataDir(), 'star-memory', 'star-memory.sqlite')
const MEMORY_TYPES = new Set<MemoryType>(['shared_event', 'durable_fact', 'agreement', 'current_state', 'observation', 'self_event', 'unresolved'])
const FAMILY_STATUSES = new Set<FamilyStatus>(['active', 'paused', 'ended', 'archived'])
const FAMILY_ROLES = new Set<FamilyMembership['role']>(['key_event', 'key_fact', 'member', 'unresolved'])
const WORKING_STATUSES = new Set<WorkingMemoryStatus>(['active', 'due', 'dismissed', 'promoted'])
const WORKING_DECISIONS = new Set<WorkingMemoryDecision>(['dismiss', 'observe', 'promote', 'ask_fire'])
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
    CREATE TABLE IF NOT EXISTS working_memories (
      id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, type TEXT NOT NULL, summary TEXT NOT NULL,
      details TEXT, why_important TEXT, star_feeling TEXT, current_understanding TEXT,
      occurred_at TEXT, valid_from TEXT, importance INTEGER NOT NULL CHECK (importance BETWEEN 1 AND 10),
      inference INTEGER NOT NULL DEFAULT 0 CHECK (inference IN (0, 1)), confidence REAL CHECK (confidence BETWEEN 0 AND 1),
      sources_json TEXT NOT NULL, quotes_json TEXT NOT NULL, family_ids_json TEXT NOT NULL,
      retention_days INTEGER NOT NULL CHECK (retention_days IN (1, 7, 14)), expires_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'due', 'dismissed', 'promoted')),
      created_by TEXT NOT NULL CHECK (created_by IN ('fire', 'star')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      candidate_id TEXT REFERENCES candidates(id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS working_active_fingerprint
      ON working_memories(fingerprint) WHERE status IN ('active', 'due');
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
      lock_owner TEXT CHECK (lock_owner IN ('fire', 'star')),
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
    CREATE TABLE IF NOT EXISTS family_summary_revisions (
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL REFERENCES families(id) ON DELETE CASCADE,
      summary TEXT, reason TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS family_recycle_bin (
      id TEXT PRIMARY KEY, family_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, payload_json TEXT NOT NULL,
      deleted_by TEXT NOT NULL CHECK (deleted_by IN ('fire', 'star')),
      deleted_at TEXT NOT NULL, purge_after TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_recycle_bin (
      id TEXT PRIMARY KEY, memory_id TEXT NOT NULL UNIQUE, summary TEXT NOT NULL, payload_json TEXT NOT NULL,
      deleted_by TEXT NOT NULL CHECK (deleted_by IN ('fire', 'star')),
      deleted_at TEXT NOT NULL, purge_after TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_conflicts (
      id TEXT PRIMARY KEY, memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      current_summary TEXT NOT NULL, proposed_summary TEXT NOT NULL, reason TEXT,
      status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
      resolution TEXT CHECK (resolution IN ('keep_current', 'use_proposal')),
      created_by TEXT NOT NULL CHECK (created_by IN ('fire', 'star')), created_at TEXT NOT NULL,
      resolved_by TEXT CHECK (resolved_by IN ('fire', 'star')), resolved_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS memory_conflicts_one_open
      ON memory_conflicts(memory_id) WHERE status = 'open';
    CREATE TABLE IF NOT EXISTS changes (
      id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL,
      target_id TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reminder_state (
      kind TEXT PRIMARY KEY, last_sent_at TEXT, last_attempt_at TEXT
    );
  `)
  const hasColumn = (table: string, column: string) => (database!.pragma(`table_info(${table})`) as Row[]).some(row => row.name === column)
  if (!hasColumn('candidates', 'lock_owner')) database.exec("ALTER TABLE candidates ADD COLUMN lock_owner TEXT CHECK (lock_owner IN ('fire', 'star'))")
  if (!hasColumn('memories', 'lock_owner')) database.exec("ALTER TABLE memories ADD COLUMN lock_owner TEXT CHECK (lock_owner IN ('fire', 'star'))")
  if (!hasColumn('families', 'lock_owner')) database.exec("ALTER TABLE families ADD COLUMN lock_owner TEXT CHECK (lock_owner IN ('fire', 'star'))")
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
    UPDATE families SET lock_owner = created_by
      WHERE locked = 1 AND lock_owner IS NULL AND created_by IN ('fire', 'star');
  `)
  database.pragma('user_version = 8')
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

function workingFromRow(row: Row): WorkingMemory {
  return {
    type: row.type,
    summary: row.summary,
    details: row.details || undefined,
    whyImportant: row.why_important || undefined,
    sources: JSON.parse(row.sources_json),
    quotes: JSON.parse(row.quotes_json),
    starFeeling: row.star_feeling || undefined,
    currentUnderstanding: row.current_understanding || undefined,
    occurredAt: row.occurred_at || undefined,
    validFrom: row.valid_from || undefined,
    importance: row.importance,
    inference: !!row.inference,
    confidence: row.confidence ?? undefined,
    locked: false,
    id: row.id,
    retentionDays: row.retention_days,
    expiresAt: row.expires_at,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    candidateId: row.candidate_id || undefined,
    suggestedFamilyIds: JSON.parse(row.family_ids_json),
  }
}

function familyFromRow(row: Row): MemoryFamily {
  return { id: row.id, name: row.name, title: row.title || undefined, summary: row.summary || undefined, status: row.status, parentId: row.parent_id || undefined, locked: !!row.locked, lockOwner: row.lock_owner || undefined, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at }
}

function conflictFromRow(row: Row): MemoryConflict {
  return {
    id: row.id, memoryId: row.memory_id, currentSummary: row.current_summary, proposedSummary: row.proposed_summary,
    reason: row.reason || undefined, status: row.status, resolution: row.resolution || undefined,
    createdBy: row.created_by, createdAt: row.created_at, resolvedBy: row.resolved_by || undefined, resolvedAt: row.resolved_at || undefined,
  }
}

function recordChange(actorValue: MemoryActor, action: string, targetId: string, now: string): void {
  getDb().prepare('INSERT INTO changes (id, actor, action, target_id, created_at) VALUES (?, ?, ?, ?, ?)').run(randomUUID(), actorValue, action, targetId, now)
}

export function getStarMemoryStatus() {
  processWorkingMemoryExpiry()
  const db = getDb()
  const count = (sql: string) => (db.prepare(sql).get() as Row).count as number
  return {
    version: Number(db.pragma('user_version', { simple: true })),
    candidates: count('SELECT COUNT(*) AS count FROM candidates'),
    pendingStar: count("SELECT COUNT(*) AS count FROM candidates WHERE status = 'pending_star'"),
    pendingFire: count("SELECT COUNT(*) AS count FROM candidates WHERE status = 'pending_fire'"),
    memories: count('SELECT COUNT(*) AS count FROM memories'),
    families: count('SELECT COUNT(*) AS count FROM families'),
    workingActive: count("SELECT COUNT(*) AS count FROM working_memories WHERE status = 'active'"),
    workingDue: count("SELECT COUNT(*) AS count FROM working_memories WHERE status = 'due'"),
    conflicts: count("SELECT COUNT(*) AS count FROM memory_conflicts WHERE status = 'open'"),
  }
}

export function claimPendingFireReminder(nowValue: unknown = new Date().toISOString()) {
  const now = iso(nowValue, 'now')!
  const nowMs = new Date(now).getTime()
  return getDb().transaction(() => {
    const candidates = getDb().prepare("SELECT id, summary FROM candidates WHERE status = 'pending_fire' ORDER BY importance DESC, created_at LIMIT 2").all() as Row[]
    const count = (getDb().prepare("SELECT COUNT(*) AS count FROM candidates WHERE status = 'pending_fire'").get() as Row).count as number
    if (!count) return null
    const state = getDb().prepare("SELECT * FROM reminder_state WHERE kind = 'pending_fire'").get() as Row | undefined
    const sentMs = state?.last_sent_at ? new Date(state.last_sent_at).getTime() : 0
    const attemptMs = state?.last_attempt_at ? new Date(state.last_attempt_at).getTime() : 0
    if (sentMs && nowMs - sentMs < 24 * 60 * 60 * 1000) return null
    if (attemptMs && nowMs - attemptMs < 60 * 60 * 1000) return null
    getDb().prepare(`INSERT INTO reminder_state (kind, last_sent_at, last_attempt_at) VALUES ('pending_fire', ?, ?)
      ON CONFLICT(kind) DO UPDATE SET last_attempt_at = excluded.last_attempt_at`).run(state?.last_sent_at || null, now)
    return { attemptedAt: now, count, summaries: candidates.map(item => String(item.summary)) }
  })()
}

export function finishPendingFireReminder(attemptedAtValue: unknown, deliveredValue: unknown, finishedAtValue: unknown = new Date().toISOString()): boolean {
  const attemptedAt = iso(attemptedAtValue, 'attemptedAt')!
  const finishedAt = iso(finishedAtValue, 'finishedAt')!
  const delivered = deliveredValue === true
  return getDb().transaction(() => {
    const state = getDb().prepare("SELECT * FROM reminder_state WHERE kind = 'pending_fire'").get() as Row | undefined
    if (!state || state.last_attempt_at !== attemptedAt) return false
    if (delivered) getDb().prepare("UPDATE reminder_state SET last_sent_at = ? WHERE kind = 'pending_fire'").run(finishedAt)
    return true
  })()
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

export function processWorkingMemoryExpiry(nowValue: unknown = new Date().toISOString()): number {
  const now = iso(nowValue, 'now')!
  return getDb().transaction(() => {
    const due = getDb().prepare("SELECT id FROM working_memories WHERE status = 'active' AND expires_at <= ?").all(now) as Row[]
    if (!due.length) return 0
    getDb().prepare("UPDATE working_memories SET status = 'due', updated_at = ? WHERE status = 'active' AND expires_at <= ?").run(now, now)
    due.forEach(row => recordChange('system', 'working.due', row.id, now))
    return due.length
  })()
}

export function listWorkingMemories(statusValue?: WorkingMemoryStatus, nowValue: unknown = new Date().toISOString()): WorkingMemory[] {
  if (statusValue && !WORKING_STATUSES.has(statusValue)) throw new Error('working memory status is invalid')
  processWorkingMemoryExpiry(nowValue)
  const rows = statusValue
    ? getDb().prepare('SELECT * FROM working_memories WHERE status = ? ORDER BY expires_at').all(statusValue)
    : getDb().prepare('SELECT * FROM working_memories ORDER BY expires_at').all()
  return (rows as Row[]).map(workingFromRow)
}

export function createWorkingMemory(input: unknown, createdByValue: unknown, retentionDaysValue: unknown = 7, nowValue: unknown = new Date().toISOString()): WorkingMemory {
  const createdBy = reviewer(createdByValue)
  const raw = input as MemoryDraft & { familyIds?: unknown[] }
  if (raw?.locked) throw new Error('short-term memory cannot be locked; promote it first')
  const value = draft({ ...raw, locked: false, validTo: undefined })
  const retentionDays = Number(retentionDaysValue)
  if (![1, 7, 14].includes(retentionDays)) throw new Error('retention days must be 1, 7, or 14')
  const suggestedFamilyIds = Array.isArray(raw.familyIds) ? Array.from(new Set(raw.familyIds.map(id => text(id, 'familyId', 100, true)!))) : []
  const now = iso(nowValue, 'now')!
  const expiresAt = new Date(new Date(now).getTime() + retentionDays * 86_400_000).toISOString()
  const fingerprint = createHash('sha256').update(`${value.type}\0${normalized(value.summary)}`).digest('hex')
  processWorkingMemoryExpiry(now)
  return getDb().transaction(() => {
    const existing = getDb().prepare("SELECT * FROM working_memories WHERE fingerprint = ? AND status IN ('active', 'due')").get(fingerprint) as Row | undefined
    if (existing) return workingFromRow(existing)
    for (const familyId of suggestedFamilyIds) {
      if (!getDb().prepare('SELECT 1 FROM families WHERE id = ?').get(familyId)) throw new Error(`family not found: ${familyId}`)
    }
    const id = randomUUID()
    getDb().prepare(`INSERT INTO working_memories
      (id, fingerprint, type, summary, details, why_important, star_feeling, current_understanding, occurred_at, valid_from,
       importance, inference, confidence, sources_json, quotes_json, family_ids_json, retention_days, expires_at,
       status, created_by, created_at, updated_at, candidate_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)`)
      .run(id, fingerprint, value.type, value.summary, value.details, value.whyImportant, value.starFeeling, value.currentUnderstanding,
        value.occurredAt, value.validFrom, value.importance, value.inference ? 1 : 0, value.confidence,
        JSON.stringify(value.sources), JSON.stringify(value.quotes || []), JSON.stringify(suggestedFamilyIds), retentionDays,
        expiresAt, createdBy, now, now)
    recordChange(createdBy, 'working.created', id, now)
    return workingFromRow(getDb().prepare('SELECT * FROM working_memories WHERE id = ?').get(id) as Row)
  })()
}

export type WorkingMemoryDecision = 'dismiss' | 'observe' | 'promote' | 'ask_fire'

export function reviewWorkingMemory(idValue: unknown, decision: WorkingMemoryDecision, reviewerValue: unknown, nowValue: unknown = new Date().toISOString(), summaryValue?: unknown) {
  const id = text(idValue, 'working memory id', 100, true)!
  const reviewedBy = reviewer(reviewerValue)
  if (!WORKING_DECISIONS.has(decision)) throw new Error('working memory decision is invalid')
  const now = iso(nowValue, 'now')!
  processWorkingMemoryExpiry(now)
  return getDb().transaction(() => {
    const row = getDb().prepare('SELECT * FROM working_memories WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new Error('working memory not found')
    const current = workingFromRow(row)
    if (current.status === 'promoted' && current.candidateId) {
      const candidateRow = getDb().prepare('SELECT * FROM candidates WHERE id = ?').get(current.candidateId) as Row
      const memoryRow = candidateRow?.memory_id ? getDb().prepare('SELECT * FROM memories WHERE id = ?').get(candidateRow.memory_id) as Row : undefined
      return { working: current, candidate: candidateRow ? candidateFromRow(candidateRow) : undefined, memory: memoryRow ? memoryFromRow(memoryRow) : undefined }
    }
    if (current.status === 'dismissed') return { working: current }
    if (decision === 'dismiss') {
      getDb().prepare("UPDATE working_memories SET status = 'dismissed', updated_at = ? WHERE id = ?").run(now, id)
      recordChange(reviewedBy, 'working.dismissed', id, now)
      return { working: workingFromRow(getDb().prepare('SELECT * FROM working_memories WHERE id = ?').get(id) as Row) }
    }
    if (decision === 'observe') {
      if (current.retentionDays >= 14) throw new Error('short-term memory cannot exceed fourteen days')
      const expiresAt = new Date(new Date(current.createdAt).getTime() + 14 * 86_400_000).toISOString()
      if (expiresAt <= now) throw new Error('the fourteen-day maximum has already passed')
      getDb().prepare("UPDATE working_memories SET retention_days = 14, expires_at = ?, status = 'active', updated_at = ? WHERE id = ?").run(expiresAt, now, id)
      recordChange(reviewedBy, 'working.observed', id, now)
      return { working: workingFromRow(getDb().prepare('SELECT * FROM working_memories WHERE id = ?').get(id) as Row) }
    }
    const candidate = createMemoryCandidate({
      ...current,
      summary: summaryValue === undefined ? current.summary : text(summaryValue, 'summary', 1_000, true),
      locked: false,
      familyIds: current.suggestedFamilyIds,
    }, current.createdBy, decision === 'ask_fire' ? 'fire' : reviewedBy)
    const reviewed = decision === 'promote' ? reviewMemoryCandidate(candidate.id, 'approve', reviewedBy) : { candidate }
    getDb().prepare("UPDATE working_memories SET status = 'promoted', candidate_id = ?, updated_at = ? WHERE id = ?").run(candidate.id, now, id)
    recordChange(reviewedBy, decision === 'promote' ? 'working.promoted' : 'working.assigned_fire', id, now)
    return { working: workingFromRow(getDb().prepare('SELECT * FROM working_memories WHERE id = ?').get(id) as Row), ...reviewed }
  })()
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
  if (raw.locked !== undefined && typeof raw.locked !== 'boolean') throw new Error('family.locked must be a boolean')
  if (!FAMILY_STATUSES.has(status)) throw new Error('family status is invalid')
  if (familyDepth(parentId) > 3) throw new Error('family nesting cannot exceed three levels')
  const now = new Date().toISOString()
  const id = randomUUID()
  try {
    getDb().transaction(() => {
      getDb().prepare('INSERT INTO families (id, name, title, summary, status, parent_id, locked, lock_owner, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, name, title, summary, status, parentId, raw.locked ? 1 : 0, raw.locked ? createdBy : null, createdBy, now, now)
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
  const revisions = (getDb().prepare('SELECT summary, reason, created_by, created_at FROM family_summary_revisions WHERE family_id = ? ORDER BY created_at DESC').all(id) as Row[]).map(item => ({
    summary: item.summary || undefined, reason: item.reason, createdBy: item.created_by, createdAt: item.created_at,
  }))
  return { ...familyFromRow(row), children: (getDb().prepare('SELECT * FROM families WHERE parent_id = ?').all(id) as Row[]).map(familyFromRow), memberships, memories, revisions }
}

export function getMemoryFamilyLevel(idValue: unknown, levelValue: unknown = 1) {
  const id = text(idValue, 'family id', 100, true)!
  const level = Math.max(1, Math.min(4, Math.floor(Number(levelValue) || 1)))
  if (level === 4) return getMemoryFamily(id)
  const row = getDb().prepare('SELECT * FROM families WHERE id = ?').get(id) as Row | undefined
  if (!row) return null
  const family = familyFromRow(row)
  const memberCount = (getDb().prepare('SELECT COUNT(*) AS count FROM family_memberships WHERE family_id = ?').get(id) as Row).count as number
  if (level === 1) return { ...family, memberCount }
  const children = (getDb().prepare('SELECT * FROM families WHERE parent_id = ? ORDER BY name COLLATE NOCASE').all(id) as Row[]).map(familyFromRow)
  const roleCounts = Object.fromEntries((getDb().prepare('SELECT role, COUNT(*) AS count FROM family_memberships WHERE family_id = ? GROUP BY role').all(id) as Row[]).map(item => [item.role, item.count]))
  if (level === 2) return { ...family, memberCount, children, roleCounts }
  const memberships = (getDb().prepare("SELECT * FROM family_memberships WHERE family_id = ? AND role != 'member' ORDER BY created_at").all(id) as Row[]).map(item => ({
    familyId: item.family_id, memoryId: item.memory_id, role: item.role, reason: item.reason || undefined, addedBy: item.added_by, createdAt: item.created_at,
  })) as FamilyMembership[]
  const memories = memberships.map(link => getDb().prepare('SELECT * FROM memories WHERE id = ?').get(link.memoryId) as Row).filter(Boolean).map(memoryFromRow)
  return { ...family, memberCount, children, roleCounts, memberships, memories }
}

function writableFamily(id: string, actorValue: 'fire' | 'star'): Row {
  const row = getDb().prepare('SELECT * FROM families WHERE id = ?').get(id) as Row | undefined
  if (!row) throw new Error('family not found')
  if (row.lock_owner && row.lock_owner !== actorValue) throw new Error(`family is locked by ${row.lock_owner}`)
  return row
}

export function updateMemoryFamily(idValue: unknown, patchValue: unknown, actorValue: unknown): MemoryFamily {
  const id = text(idValue, 'family id', 100, true)!
  const updatedBy = reviewer(actorValue)
  if (!patchValue || typeof patchValue !== 'object') throw new Error('family patch is required')
  const raw = patchValue as Partial<MemoryFamily> & { major?: unknown; reason?: unknown }
  return getDb().transaction(() => {
    const current = familyFromRow(writableFamily(id, updatedBy))
    const name = raw.name === undefined ? current.name : text(raw.name, 'family.name', 120, true)!
    const title = raw.title === undefined ? current.title : text(raw.title, 'family.title', 200)
    const summary = raw.summary === undefined ? current.summary : text(raw.summary, 'family.summary', 2_000)
    const status = raw.status === undefined ? current.status : raw.status
    if (!FAMILY_STATUSES.has(status)) throw new Error('family status is invalid')
    const now = new Date().toISOString()
    const major = raw.major === true || status !== current.status
    if (major && (summary !== current.summary || status !== current.status)) {
      getDb().prepare('INSERT INTO family_summary_revisions (id, family_id, summary, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), id, current.summary, text(raw.reason, 'family revision reason', 300) || (status !== current.status ? `status:${current.status}->${status}` : 'major_summary'), updatedBy, now)
    }
    getDb().prepare('UPDATE families SET name = ?, title = ?, summary = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(name, title, summary, status, now, id)
    recordChange(updatedBy, 'family.updated', id, now)
    return familyFromRow(getDb().prepare('SELECT * FROM families WHERE id = ?').get(id) as Row)
  })()
}

export function setMemoryFamilyLock(idValue: unknown, lockedValue: unknown, actorValue: unknown): MemoryFamily {
  const id = text(idValue, 'family id', 100, true)!
  const lockActor = reviewer(actorValue)
  if (typeof lockedValue !== 'boolean') throw new Error('locked must be a boolean')
  return getDb().transaction(() => {
    writableFamily(id, lockActor)
    const now = new Date().toISOString()
    getDb().prepare('UPDATE families SET locked = ?, lock_owner = ?, updated_at = ? WHERE id = ?')
      .run(lockedValue ? 1 : 0, lockedValue ? lockActor : null, now, id)
    recordChange(lockActor, lockedValue ? 'family.locked' : 'family.unlocked', id, now)
    return familyFromRow(getDb().prepare('SELECT * FROM families WHERE id = ?').get(id) as Row)
  })()
}

export function setMemoryFamilyMembership(familyIdValue: unknown, memoryIdValue: unknown, roleValue: unknown, reasonValue: unknown, actorValue: unknown): FamilyMembership {
  const familyId = text(familyIdValue, 'family id', 100, true)!
  const memoryId = text(memoryIdValue, 'memory id', 100, true)!
  const addedBy = reviewer(actorValue)
  const role = text(roleValue, 'family role', 30, true)! as FamilyMembership['role']
  if (!FAMILY_ROLES.has(role)) throw new Error('family role is invalid')
  const reason = text(reasonValue, 'family membership reason', 500)
  return getDb().transaction(() => {
    writableFamily(familyId, addedBy)
    writableMemory(memoryId, addedBy)
    const now = new Date().toISOString()
    getDb().prepare(`INSERT INTO family_memberships (family_id, memory_id, role, reason, added_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(family_id, memory_id) DO UPDATE SET role = excluded.role, reason = excluded.reason, added_by = excluded.added_by`)
      .run(familyId, memoryId, role, reason, addedBy, now)
    recordChange(addedBy, 'family.member_set', familyId, now)
    const row = getDb().prepare('SELECT * FROM family_memberships WHERE family_id = ? AND memory_id = ?').get(familyId, memoryId) as Row
    return { familyId, memoryId, role: row.role, reason: row.reason || undefined, addedBy: row.added_by, createdAt: row.created_at }
  })()
}

export function removeMemoryFamilyMembership(familyIdValue: unknown, memoryIdValue: unknown, actorValue: unknown): boolean {
  const familyId = text(familyIdValue, 'family id', 100, true)!
  const memoryId = text(memoryIdValue, 'memory id', 100, true)!
  const removedBy = reviewer(actorValue)
  return getDb().transaction(() => {
    writableFamily(familyId, removedBy)
    writableMemory(memoryId, removedBy)
    const removed = getDb().prepare('DELETE FROM family_memberships WHERE family_id = ? AND memory_id = ?').run(familyId, memoryId).changes > 0
    if (removed) recordChange(removedBy, 'family.member_removed', familyId, new Date().toISOString())
    return removed
  })()
}

export function endMemoryFamily(idValue: unknown, actorValue: unknown): { family: MemoryFamily; removedOrdinaryMembers: number } {
  const id = text(idValue, 'family id', 100, true)!
  const endedBy = reviewer(actorValue)
  return getDb().transaction(() => {
    const current = familyFromRow(writableFamily(id, endedBy))
    const ordinaryMembers = getDb().prepare("SELECT memory_id FROM family_memberships WHERE family_id = ? AND role = 'member'").all(id) as Row[]
    ordinaryMembers.forEach(link => writableMemory(link.memory_id, endedBy))
    const now = new Date().toISOString()
    if (current.status !== 'ended') {
      getDb().prepare('INSERT INTO family_summary_revisions (id, family_id, summary, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(randomUUID(), id, current.summary, 'family_ended', endedBy, now)
    }
    const removedOrdinaryMembers = getDb().prepare("DELETE FROM family_memberships WHERE family_id = ? AND role = 'member'").run(id).changes
    getDb().prepare("UPDATE families SET status = 'ended', updated_at = ? WHERE id = ?").run(now, id)
    recordChange(endedBy, 'family.ended', id, now)
    return { family: familyFromRow(getDb().prepare('SELECT * FROM families WHERE id = ?').get(id) as Row), removedOrdinaryMembers }
  })()
}

function recycledFamilyFromRow(row: Row): RecycledFamily {
  return { id: row.id, familyId: row.family_id, name: row.name, deletedBy: row.deleted_by, deletedAt: row.deleted_at, purgeAfter: row.purge_after }
}

export function listRecycledFamilies(nowValue: unknown = new Date().toISOString()): RecycledFamily[] {
  purgeExpiredFamilyRecycleBin(nowValue)
  return (getDb().prepare('SELECT * FROM family_recycle_bin ORDER BY deleted_at DESC').all() as Row[]).map(recycledFamilyFromRow)
}

export function recycleMemoryFamily(idValue: unknown, actorValue: unknown, nowValue: unknown = new Date().toISOString()): RecycledFamily {
  const id = text(idValue, 'family id', 100, true)!
  const deletedBy = reviewer(actorValue)
  const now = iso(nowValue, 'now')!
  const purgeAfter = new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000).toISOString()
  return getDb().transaction(() => {
    const family = writableFamily(id, deletedBy)
    if (getDb().prepare('SELECT 1 FROM families WHERE parent_id = ? LIMIT 1').get(id)) throw new Error('move or recycle child families first')
    const memberships = getDb().prepare('SELECT * FROM family_memberships WHERE family_id = ?').all(id) as Row[]
    memberships.forEach(link => writableMemory(link.memory_id, deletedBy))
    const revisions = getDb().prepare('SELECT * FROM family_summary_revisions WHERE family_id = ?').all(id) as Row[]
    const candidateIds = (getDb().prepare('SELECT candidate_id FROM candidate_family_suggestions WHERE family_id = ?').all(id) as Row[]).map(row => row.candidate_id)
    const workingRows = getDb().prepare("SELECT id, family_ids_json FROM working_memories WHERE status IN ('active', 'due')").all() as Row[]
    const workingIds = workingRows.filter(row => (JSON.parse(row.family_ids_json) as string[]).includes(id)).map(row => row.id)
    candidateIds.forEach(candidateId => getDb().prepare('DELETE FROM candidate_family_suggestions WHERE candidate_id = ? AND family_id = ?').run(candidateId, id))
    workingRows.forEach(row => {
      const familyIds = JSON.parse(row.family_ids_json) as string[]
      if (familyIds.includes(id)) getDb().prepare('UPDATE working_memories SET family_ids_json = ? WHERE id = ?').run(JSON.stringify(familyIds.filter(familyId => familyId !== id)), row.id)
    })
    const recycleId = randomUUID()
    getDb().prepare('INSERT INTO family_recycle_bin (id, family_id, name, payload_json, deleted_by, deleted_at, purge_after) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(recycleId, id, family.name, JSON.stringify({ family, memberships, revisions, candidateIds, workingIds }), deletedBy, now, purgeAfter)
    getDb().prepare('DELETE FROM families WHERE id = ?').run(id)
    recordChange(deletedBy, 'family.recycled', id, now)
    return recycledFamilyFromRow(getDb().prepare('SELECT * FROM family_recycle_bin WHERE id = ?').get(recycleId) as Row)
  })()
}

export function restoreMemoryFamily(recycleIdValue: unknown, actorValue: unknown): MemoryFamily {
  const recycleId = text(recycleIdValue, 'recycle id', 100, true)!
  const restoredBy = reviewer(actorValue)
  return getDb().transaction(() => {
    const recycled = getDb().prepare('SELECT * FROM family_recycle_bin WHERE id = ?').get(recycleId) as Row | undefined
    if (!recycled) throw new Error('recycled family not found')
    const payload = JSON.parse(recycled.payload_json) as { family: Row; memberships: Row[]; revisions: Row[]; candidateIds: string[]; workingIds: string[] }
    const family = payload.family
    getDb().prepare(`INSERT INTO families (id, name, title, summary, status, parent_id, locked, lock_owner, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(family.id, family.name, family.title, family.summary, family.status, family.parent_id, family.locked, family.lock_owner, family.created_by, family.created_at, family.updated_at)
    const addMembership = getDb().prepare('INSERT INTO family_memberships (family_id, memory_id, role, reason, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    payload.memberships.forEach(link => {
      if (getDb().prepare('SELECT 1 FROM memories WHERE id = ?').get(link.memory_id)) addMembership.run(family.id, link.memory_id, link.role, link.reason, link.added_by, link.created_at)
    })
    const addRevision = getDb().prepare('INSERT INTO family_summary_revisions (id, family_id, summary, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    payload.revisions.forEach(revision => addRevision.run(revision.id, family.id, revision.summary, revision.reason, revision.created_by, revision.created_at))
    const addSuggestion = getDb().prepare('INSERT OR IGNORE INTO candidate_family_suggestions (candidate_id, family_id) VALUES (?, ?)')
    payload.candidateIds.forEach(candidateId => {
      if (getDb().prepare('SELECT 1 FROM candidates WHERE id = ?').get(candidateId)) addSuggestion.run(candidateId, family.id)
    })
    payload.workingIds.forEach(workingId => {
      const row = getDb().prepare('SELECT family_ids_json FROM working_memories WHERE id = ?').get(workingId) as Row | undefined
      if (!row) return
      const familyIds = JSON.parse(row.family_ids_json) as string[]
      if (!familyIds.includes(family.id)) getDb().prepare('UPDATE working_memories SET family_ids_json = ? WHERE id = ?').run(JSON.stringify([...familyIds, family.id]), workingId)
    })
    getDb().prepare('DELETE FROM family_recycle_bin WHERE id = ?').run(recycleId)
    recordChange(restoredBy, 'family.restored', family.id, new Date().toISOString())
    return familyFromRow(getDb().prepare('SELECT * FROM families WHERE id = ?').get(family.id) as Row)
  })()
}

export function purgeExpiredFamilyRecycleBin(nowValue: unknown = new Date().toISOString()): number {
  const now = iso(nowValue, 'now')!
  return getDb().prepare('DELETE FROM family_recycle_bin WHERE purge_after <= ?').run(now).changes
}

export function mergeMemoryFamilies(sourceIdValue: unknown, targetIdValue: unknown, summaryValue: unknown, actorValue: unknown) {
  const sourceId = text(sourceIdValue, 'source family id', 100, true)!
  const targetId = text(targetIdValue, 'target family id', 100, true)!
  const mergedBy = reviewer(actorValue)
  if (sourceId === targetId) throw new Error('source and target families must differ')
  const summary = text(summaryValue, 'merged family summary', 2_000)
  return getDb().transaction(() => {
    const source = familyFromRow(writableFamily(sourceId, mergedBy))
    const target = familyFromRow(writableFamily(targetId, mergedBy))
    if (getDb().prepare('SELECT 1 FROM families WHERE parent_id = ? LIMIT 1').get(sourceId)) throw new Error('move or merge child families first')
    const now = new Date().toISOString()
    const sourceLinks = getDb().prepare('SELECT * FROM family_memberships WHERE family_id = ?').all(sourceId) as Row[]
    sourceLinks.forEach(link => writableMemory(link.memory_id, mergedBy))
    const readTargetLink = getDb().prepare('SELECT * FROM family_memberships WHERE family_id = ? AND memory_id = ?')
    const addTargetLink = getDb().prepare(`INSERT INTO family_memberships (family_id, memory_id, role, reason, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(family_id, memory_id) DO UPDATE SET role = excluded.role, reason = COALESCE(family_memberships.reason, excluded.reason), added_by = excluded.added_by`)
    sourceLinks.forEach(link => {
      const existing = readTargetLink.get(targetId, link.memory_id) as Row | undefined
      const role = existing && existing.role !== 'member' ? existing.role : link.role
      addTargetLink.run(targetId, link.memory_id, role, link.reason, mergedBy, existing?.created_at || link.created_at)
    })
    const candidateIds = (getDb().prepare('SELECT candidate_id FROM candidate_family_suggestions WHERE family_id = ?').all(sourceId) as Row[]).map(row => row.candidate_id)
    candidateIds.forEach(candidateId => getDb().prepare('INSERT OR IGNORE INTO candidate_family_suggestions (candidate_id, family_id) VALUES (?, ?)').run(candidateId, targetId))
    const workingRows = getDb().prepare("SELECT id, family_ids_json FROM working_memories WHERE status IN ('active', 'due')").all() as Row[]
    workingRows.forEach(row => {
      const familyIds = JSON.parse(row.family_ids_json) as string[]
      if (familyIds.includes(sourceId)) getDb().prepare('UPDATE working_memories SET family_ids_json = ? WHERE id = ?').run(JSON.stringify(Array.from(new Set(familyIds.map(id => id === sourceId ? targetId : id)))), row.id)
    })
    getDb().prepare('INSERT INTO family_summary_revisions (id, family_id, summary, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), targetId, target.summary, `merged:${sourceId}`, mergedBy, now)
    getDb().prepare('UPDATE families SET summary = ?, updated_at = ? WHERE id = ?').run(summary ?? target.summary, now, targetId)
    getDb().prepare('DELETE FROM family_memberships WHERE family_id = ?').run(sourceId)
    getDb().prepare('DELETE FROM candidate_family_suggestions WHERE family_id = ?').run(sourceId)
    const recycled = recycleMemoryFamily(sourceId, mergedBy, now)
    recordChange(mergedBy, 'family.merged', targetId, now)
    return { family: familyFromRow(getDb().prepare('SELECT * FROM families WHERE id = ?').get(targetId) as Row), recycled, movedMemories: sourceLinks.length }
  })()
}

export function splitMemoryFamily(sourceIdValue: unknown, familyValue: unknown, memoryIdsValue: unknown, actorValue: unknown) {
  const sourceId = text(sourceIdValue, 'source family id', 100, true)!
  const splitBy = reviewer(actorValue)
  if (!Array.isArray(memoryIdsValue) || memoryIdsValue.length === 0) throw new Error('split needs at least one memory id')
  const memoryIds = Array.from(new Set(memoryIdsValue.map(value => text(value, 'memory id', 100, true)!)))
  if (!familyValue || typeof familyValue !== 'object') throw new Error('new family is required')
  return getDb().transaction(() => {
    const source = familyFromRow(writableFamily(sourceId, splitBy))
    const links = memoryIds.map(memoryId => {
      const link = getDb().prepare('SELECT * FROM family_memberships WHERE family_id = ? AND memory_id = ?').get(sourceId, memoryId) as Row | undefined
      if (!link) throw new Error(`memory is not in source family: ${memoryId}`)
      writableMemory(memoryId, splitBy)
      return link
    })
    const raw = familyValue as Partial<MemoryFamily>
    const created = createMemoryFamily({ ...raw, parentId: raw.parentId === undefined ? source.parentId : raw.parentId }, splitBy)
    const add = getDb().prepare('INSERT INTO family_memberships (family_id, memory_id, role, reason, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    links.forEach(link => {
      add.run(created.id, link.memory_id, link.role, link.reason, splitBy, link.created_at)
      getDb().prepare('DELETE FROM family_memberships WHERE family_id = ? AND memory_id = ?').run(sourceId, link.memory_id)
    })
    const now = new Date().toISOString()
    getDb().prepare('UPDATE families SET updated_at = ? WHERE id = ?').run(now, sourceId)
    getDb().prepare('INSERT INTO family_summary_revisions (id, family_id, summary, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), sourceId, source.summary, `split:${created.id}`, splitBy, now)
    recordChange(splitBy, 'family.split', sourceId, now)
    return { source: familyFromRow(getDb().prepare('SELECT * FROM families WHERE id = ?').get(sourceId) as Row), family: created, movedMemories: links.length }
  })()
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
      writableFamily(familyId, approvedBy)
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

export function listMemoryConflicts(openOnly = true): MemoryConflict[] {
  const rows = openOnly
    ? getDb().prepare("SELECT * FROM memory_conflicts WHERE status = 'open' ORDER BY created_at DESC").all()
    : getDb().prepare('SELECT * FROM memory_conflicts ORDER BY created_at DESC').all()
  return (rows as Row[]).map(conflictFromRow)
}

export function createMemoryConflict(memoryIdValue: unknown, proposedSummaryValue: unknown, reasonValue: unknown, actorValue: unknown): MemoryConflict {
  const memoryId = text(memoryIdValue, 'memory id', 100, true)!
  const proposedSummary = text(proposedSummaryValue, 'proposed summary', 1_000, true)!
  const reason = text(reasonValue, 'conflict reason', 1_000)
  const createdBy = reviewer(actorValue)
  const row = getDb().prepare('SELECT summary FROM memories WHERE id = ?').get(memoryId) as Row | undefined
  if (!row) throw new Error('memory not found')
  const now = new Date().toISOString()
  const id = randomUUID()
  try {
    getDb().prepare(`INSERT INTO memory_conflicts
      (id, memory_id, current_summary, proposed_summary, reason, status, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?)`)
      .run(id, memoryId, row.summary, proposedSummary, reason, createdBy, now)
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) throw new Error('memory already has an open conflict')
    throw error
  }
  recordChange(createdBy, 'memory.conflict_opened', memoryId, now)
  return conflictFromRow(getDb().prepare('SELECT * FROM memory_conflicts WHERE id = ?').get(id) as Row)
}

export function resolveMemoryConflict(idValue: unknown, resolutionValue: unknown, actorValue: unknown): { conflict: MemoryConflict; memory: CanonicalMemory } {
  const id = text(idValue, 'conflict id', 100, true)!
  const resolution = text(resolutionValue, 'conflict resolution', 30, true)! as MemoryConflictResolution
  if (!new Set<MemoryConflictResolution>(['keep_current', 'use_proposal']).has(resolution)) throw new Error('conflict resolution is invalid')
  const resolvedBy = reviewer(actorValue)
  return getDb().transaction(() => {
    const row = getDb().prepare("SELECT * FROM memory_conflicts WHERE id = ? AND status = 'open'").get(id) as Row | undefined
    if (!row) throw new Error('open memory conflict not found')
    if (resolution === 'use_proposal') updateCanonicalMemory(row.memory_id, { summary: row.proposed_summary }, resolvedBy)
    const now = new Date().toISOString()
    getDb().prepare("UPDATE memory_conflicts SET status = 'resolved', resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?")
      .run(resolution, resolvedBy, now, id)
    recordChange(resolvedBy, `memory.conflict_${resolution}`, row.memory_id, now)
    return {
      conflict: conflictFromRow(getDb().prepare('SELECT * FROM memory_conflicts WHERE id = ?').get(id) as Row),
      memory: memoryFromRow(getDb().prepare('SELECT * FROM memories WHERE id = ?').get(row.memory_id) as Row),
    }
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

function recycledMemoryFromRow(row: Row): RecycledMemory {
  return { id: row.id, memoryId: row.memory_id, summary: row.summary, deletedBy: row.deleted_by, deletedAt: row.deleted_at, purgeAfter: row.purge_after }
}

export function listRecycledMemories(nowValue: unknown = new Date().toISOString()): RecycledMemory[] {
  purgeExpiredMemoryRecycleBin(nowValue)
  return (getDb().prepare('SELECT * FROM memory_recycle_bin ORDER BY deleted_at DESC').all() as Row[]).map(recycledMemoryFromRow)
}

export function recycleCanonicalMemory(idValue: unknown, actorValue: unknown, nowValue: unknown = new Date().toISOString()): RecycledMemory {
  const id = text(idValue, 'memory id', 100, true)!
  const deletedBy = reviewer(actorValue)
  const now = iso(nowValue, 'now')!
  const purgeAfter = new Date(new Date(now).getTime() + 24 * 60 * 60 * 1000).toISOString()
  return getDb().transaction(() => {
    const memory = memoryFromRow(writableMemory(id, deletedBy))
    const memberships = getDb().prepare('SELECT * FROM family_memberships WHERE memory_id = ?').all(id) as Row[]
    const conflicts = getDb().prepare('SELECT * FROM memory_conflicts WHERE memory_id = ?').all(id) as Row[]
    const recycleId = randomUUID()
    getDb().prepare('INSERT INTO memory_recycle_bin (id, memory_id, summary, payload_json, deleted_by, deleted_at, purge_after) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(recycleId, id, memory.summary, JSON.stringify({ memory, memberships, conflicts }), deletedBy, now, purgeAfter)
    getDb().prepare("DELETE FROM source_refs WHERE target_type = 'memory' AND target_id = ?").run(id)
    getDb().prepare("DELETE FROM quotes WHERE target_type = 'memory' AND target_id = ?").run(id)
    getDb().prepare('DELETE FROM memories WHERE id = ?').run(id)
    recordChange(deletedBy, 'memory.recycled', id, now)
    return recycledMemoryFromRow(getDb().prepare('SELECT * FROM memory_recycle_bin WHERE id = ?').get(recycleId) as Row)
  })()
}

export function restoreCanonicalMemory(recycleIdValue: unknown, actorValue: unknown): CanonicalMemory {
  const recycleId = text(recycleIdValue, 'recycle id', 100, true)!
  const restoredBy = reviewer(actorValue)
  return getDb().transaction(() => {
    const recycled = getDb().prepare('SELECT * FROM memory_recycle_bin WHERE id = ?').get(recycleId) as Row | undefined
    if (!recycled) throw new Error('recycled memory not found')
    const payload = JSON.parse(recycled.payload_json) as { memory: CanonicalMemory; memberships: Row[]; conflicts?: Row[] }
    const memory = payload.memory
    getDb().prepare(`INSERT INTO memories
      (id, type, summary, details, why_important, star_feeling, current_understanding, occurred_at, valid_from, valid_to, importance, inference, confidence, locked, lock_owner, created_by, approved_by, created_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
      .run(memory.id, ...draftValues(memory), memory.lockOwner, memory.createdBy, memory.approvedBy, memory.createdAt)
    writeSources('memory', memory.id, memory.sources)
    writeQuotes('memory', memory.id, memory.quotes)
    const addMembership = getDb().prepare('INSERT INTO family_memberships (family_id, memory_id, role, reason, added_by, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    payload.memberships.forEach(link => {
      if (getDb().prepare('SELECT 1 FROM families WHERE id = ?').get(link.family_id)) addMembership.run(link.family_id, memory.id, link.role, link.reason, link.added_by, link.created_at)
    })
    const addConflict = getDb().prepare(`INSERT INTO memory_conflicts
      (id, memory_id, current_summary, proposed_summary, reason, status, resolution, created_by, created_at, resolved_by, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const conflicts = payload.conflicts || []
    conflicts.forEach(conflict => addConflict.run(conflict.id, memory.id, conflict.current_summary, conflict.proposed_summary, conflict.reason, conflict.status, conflict.resolution, conflict.created_by, conflict.created_at, conflict.resolved_by, conflict.resolved_at))
    getDb().prepare('DELETE FROM memory_recycle_bin WHERE id = ?').run(recycleId)
    recordChange(restoredBy, 'memory.restored', memory.id, new Date().toISOString())
    return memoryFromRow(getDb().prepare('SELECT * FROM memories WHERE id = ?').get(memory.id) as Row)
  })()
}

export function purgeExpiredMemoryRecycleBin(nowValue: unknown = new Date().toISOString()): number {
  const now = iso(nowValue, 'now')!
  return getDb().prepare('DELETE FROM memory_recycle_bin WHERE purge_after <= ?').run(now).changes
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

function vectorRelevance(haystack: string, query: string): number {
  const left = bigrams(haystack)
  const right = bigrams(query)
  if (!left.size || !right.size) return 0
  let overlap = 0
  right.forEach(gram => { if (left.has(gram)) overlap += 1 })
  return (overlap / Math.sqrt(left.size * right.size)) * 70
}

export type RecallQuestionType = 'exact' | 'current' | 'theme' | 'similar' | 'change' | 'general'

export function classifyRecallQuestion(queryValue: unknown): RecallQuestionType {
  const query = text(queryValue, 'query', 500, true)!
  if (/第一次|原话|哪一天|哪天|什么时候|日期/.test(query)) return 'exact'
  if (/现在|目前|如今|当前|还(?:在|是|会|有|喜欢|想)/.test(query)) return 'current'
  if (/变化|改变|这些年|后来|以前.*现在/.test(query)) return 'change'
  if (/类似|像这样|以前有没有|也发生过/.test(query)) return 'similar'
  if (/生活|历程|故事|项目|家族/.test(query)) return 'theme'
  return 'general'
}

function recencyBonus(value: string | undefined, now: string): number {
  if (!value) return 0
  const days = Math.max(0, (new Date(now).getTime() - new Date(value).getTime()) / 86_400_000)
  return days <= 30 ? 4 : days <= 365 ? 2 : 1
}

export function recallWorkingMemories(queryValue: unknown, limitValue: unknown = 10, nowValue: unknown = new Date().toISOString(), minimumRelevance = 20) {
  const query = text(queryValue, 'query', 500, true)!
  const now = iso(nowValue, 'now')!
  const limit = Math.max(1, Math.min(20, Number(limitValue) || 10))
  return listWorkingMemories('active', now).map(memory => {
    const memoryText = [memory.summary, memory.details, memory.whyImportant, memory.currentUnderstanding, ...(memory.quotes || []).map(item => item.text), ...memory.sources.map(item => item.excerpt)].filter(Boolean).join(' ')
    const keyword = relevance(memoryText, query)
    const semantic = vectorRelevance(memoryText, query)
    const relevanceScore = Math.max(keyword, semantic)
    const importance = (memory.importance || 5) * 1.5
    const current = 8
    const emotion = memory.starFeeling ? 2 : memory.quotes?.length ? 1 : 0
    const recent = recencyBonus(memory.occurredAt || memory.createdAt, now)
    const score = relevanceScore + importance + current + emotion + recent
    return { memory, score: Number(score.toFixed(2)), relevance: Number(relevanceScore.toFixed(2)), match: keyword >= semantic ? 'keyword' as const : 'semantic' as const, breakdown: { keyword: Number(keyword.toFixed(2)), semantic: Number(semantic.toFixed(2)), importance, current, emotion, recent } }
  }).filter(item => item.relevance >= minimumRelevance).sort((a, b) => b.score - a.score).slice(0, limit)
}

export function recallStarMemories(queryValue: unknown, limitValue: unknown = 10, minimumRelevance = 20) {
  const query = text(queryValue, 'query', 500, true)!
  const limit = Math.max(1, Math.min(20, Number(limitValue) || 10))
  const questionType = classifyRecallQuestion(query)
  const memories = (getDb().prepare('SELECT * FROM memories').all() as Row[]).map(memoryFromRow)
  const families = (getDb().prepare('SELECT * FROM families').all() as Row[]).map(familyFromRow)
  const familyScores = new Map(families.map(family => {
    const familyText = `${family.name} ${family.title || ''} ${family.summary || ''}`
    return [family.id, { keyword: relevance(familyText, query), semantic: vectorRelevance(familyText, query) }] as const
  }))
  const now = new Date().toISOString()
  return memories.map(memory => {
    const familyIds = (getDb().prepare('SELECT family_id FROM family_memberships WHERE memory_id = ?').all(memory.id) as Row[]).map(item => item.family_id)
    const linkedFamilies = familyIds.map(id => families.find(item => item.id === id)).filter((item): item is MemoryFamily => !!item)
    const memoryText = [memory.summary, memory.details, memory.whyImportant, memory.currentUnderstanding, ...(memory.quotes || []).map(item => item.text), ...memory.sources.map(item => item.excerpt)].filter(Boolean).join(' ')
    const keyword = relevance(memoryText, query)
    const semantic = vectorRelevance(memoryText, query)
    const familyKeyword = Math.max(0, ...linkedFamilies.map(item => familyScores.get(item.id)?.keyword || 0))
    const familySemantic = Math.max(0, ...linkedFamilies.map(item => familyScores.get(item.id)?.semantic || 0))
    const family = Math.max(familyKeyword, familySemantic) * 0.85
    const relevanceScore = Math.max(keyword, semantic, family)
    const current = !memory.validTo || memory.validTo >= now
    const importance = (memory.importance || 5) * 1.5
    const currentBonus = current ? 8 : 0
    const emotion = memory.starFeeling ? 2 : memory.quotes?.length ? 1 : 0
    const recent = recencyBonus(memory.occurredAt || memory.createdAt, now)
    const score = relevanceScore + importance + currentBonus + emotion + recent
    const match = family >= keyword && family >= semantic ? 'family' as const : keyword >= semantic ? 'keyword' as const : 'semantic' as const
    return { memory, families: linkedFamilies, score: Number(score.toFixed(2)), relevance: Number(relevanceScore.toFixed(2)), match, current, breakdown: { keyword: Number(keyword.toFixed(2)), semantic: Number(semantic.toFixed(2)), family: Number(family.toFixed(2)), importance, current: currentBonus, emotion, recent } }
  }).filter(item => item.relevance >= minimumRelevance && (questionType !== 'current' || item.current)).sort((a, b) => b.score - a.score).slice(0, limit)
}

export function recallStarMemoryBundle(queryValue: unknown, limitValue: unknown = 5) {
  const query = text(queryValue, 'query', 500, true)!
  const limit = Math.max(1, Math.min(10, Number(limitValue) || 5))
  // ponytail: scan-derived vectors are enough for a two-person library; persist an ANN index only after measured scale needs it.
  const formal = recallStarMemories(query, limit * 2, 8).map(hit => ({
    id: hit.memory.id,
    memory_kind: 'formal' as const,
    type: hit.memory.type,
    summary: hit.memory.summary,
    occurred_at: hit.memory.occurredAt,
    current: hit.current,
    importance: hit.memory.importance,
    locked_by: hit.memory.lockOwner,
    families: hit.families.map(family => ({ id: family.id, name: family.name })),
    recall_reason: hit.match === 'family' ? '家族摘要相关' : hit.match === 'semantic' ? '本地语义向量相关' : '关键词或原话相关',
    score: hit.score,
    relevance: hit.relevance,
    breakdown: hit.breakdown,
  }))
  const working = recallWorkingMemories(query, limit * 2, new Date().toISOString(), 8).map(hit => ({
    id: hit.memory.id,
    memory_kind: 'short_term' as const,
    type: hit.memory.type,
    summary: hit.memory.summary,
    occurred_at: hit.memory.occurredAt,
    current: true,
    importance: hit.memory.importance,
    expires_at: hit.memory.expiresAt,
    families: hit.memory.suggestedFamilyIds,
    recall_reason: hit.match === 'semantic' ? '仍有效的近期记忆与问题语义相关' : '仍有效的近期记忆命中关键词',
    score: hit.score,
    relevance: hit.relevance,
    breakdown: hit.breakdown,
  }))
  const ranked = [...formal, ...working].sort((a, b) => b.score - a.score)
  const reliable = ranked.filter(item => item.relevance >= 20).slice(0, limit)
  const fuzzy = reliable.length ? [] : ranked.filter(item => item.relevance >= 8).slice(0, limit)
  const status = reliable.length ? 'reliable' as const : fuzzy.length ? 'fuzzy' as const : 'not_found' as const
  const questionType = classifyRecallQuestion(query)
  return {
    status,
    query_type: questionType,
    message: status === 'reliable' ? '找到可靠记忆。' : status === 'fuzzy' ? '只有模糊相关内容，不能当作确定事实。' : '没有找到可靠记忆。',
    certainty_note: questionType === 'exact' && /第一次/.test(query) ? '命中内容不能单独证明这是第一次。' : undefined,
    hits: status === 'reliable' ? reliable : fuzzy,
  }
}

export function buildStarMemoryContext(queryValue: unknown, existingContextValue: unknown = '', limitValue: unknown = 3): string {
  const query = typeof queryValue === 'string' ? queryValue.trim().slice(0, 500) : ''
  if (!query) return ''
  const bundle = recallStarMemoryBundle(query, limitValue)
  const existing = normalized(typeof existingContextValue === 'string' ? existingContextValue.slice(0, 100_000) : '')
  if (bundle.status !== 'reliable') {
    try {
      const diary = readDiaries('star', { author_filter: 'star' }).filter(entry => !entry.locked).map(entry => {
        const diaryText = `${entry.title || ''} ${String(entry.content || '').slice(0, 5_000)} ${(entry.tags || []).join(' ')}`
        return { entry, score: Math.max(relevance(diaryText, query), vectorRelevance(diaryText, query)) }
      }).filter(item => item.score >= 55).sort((a, b) => b.score - a.score)[0]
      if (!diary || existing.includes(normalized(`${diary.entry.title || ''}${String(diary.entry.content || '').slice(0, 500)}`))) return ''
      return [
        '[星星日记低频联想｜这是星星自己当时的感受，不是小火说过的事实]',
        `- ${diary.entry.date} ${diary.entry.time_id}《${diary.entry.title || '无题'}》：${String(diary.entry.content || '').slice(0, 500)}`,
        '只在自然相关时可说“这让我想起我当时的感受”；不得写成“小火说过”。是否分享日记原文由你决定。',
      ].join('\n')
    } catch { return '' }
  }
  const seen = new Set<string>()
  const hits = bundle.hits.filter(hit => {
    const key = normalized(hit.summary)
    if (!key || seen.has(key) || existing.includes(key)) return false
    seen.add(key)
    return true
  })
  if (!hits.length) return ''
  const lines = hits.map(hit => {
    const familyNames = hit.memory_kind === 'formal' ? hit.families.map(item => item.name) : []
    return `- ${hit.summary}${familyNames.length ? `（家族：${familyNames.join('、')}）` : ''}；${hit.recall_reason}`
  })
  return [
    '[新记忆库主动召回｜仅在自然相关时使用，不要逐条播报]',
    ...lines,
    bundle.certainty_note ? `注意：${bundle.certainty_note}` : '',
    '需要更多证据时调用 recall_memory；需要展开家族时调用 manage_memory_family。',
  ].filter(Boolean).join('\n')
}

export function resolveMemorySources(memoryIdValue: unknown) {
  const memoryId = text(memoryIdValue, 'memory id', 100, true)!
  const row = getDb().prepare('SELECT * FROM memories WHERE id = ?').get(memoryId) as Row | undefined
  if (!row) throw new Error('memory not found')
  return resolveSources(memoryFromRow(row).sources)
}

export function resolveWorkingMemorySources(memoryIdValue: unknown) {
  const memoryId = text(memoryIdValue, 'working memory id', 100, true)!
  const row = getDb().prepare('SELECT * FROM working_memories WHERE id = ?').get(memoryId) as Row | undefined
  if (!row) throw new Error('working memory not found')
  return resolveSources(workingFromRow(row).sources)
}

function resolveSources(values: SourceRef[]) {
  return values.map(source => {
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
