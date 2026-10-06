import { randomUUID } from 'node:crypto'
import { getDataDir } from './data/config'
import { readChatSession } from './data/repositories/chat'
import { readJsonFile, updateJsonFile } from './data/json-file'
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
}

export interface CanonicalMemory extends MemoryDraft {
  id: string
  createdBy: MemoryActor
  approvedBy: 'fire' | 'star'
  createdAt: string
  status: 'active'
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

interface ChangeRecord {
  id: string
  actor: MemoryActor
  action: string
  targetId: string
  createdAt: string
}

interface StarMemoryStore {
  version: 1
  candidates: MemoryCandidate[]
  memories: CanonicalMemory[]
  families: MemoryFamily[]
  memberships: FamilyMembership[]
  changes: ChangeRecord[]
}

const STORE_FILE = resolveDataPath(getDataDir(), 'star-memory', 'store.json')
const MEMORY_TYPES = new Set<MemoryType>(['shared_event', 'durable_fact', 'agreement', 'current_state', 'observation', 'self_event', 'unresolved'])
const FAMILY_STATUSES = new Set<FamilyStatus>(['active', 'paused', 'ended', 'archived'])

function emptyStore(): StarMemoryStore {
  return { version: 1, candidates: [], memories: [], families: [], memberships: [], changes: [] }
}

function validStore(value: unknown): value is StarMemoryStore {
  const store = value as StarMemoryStore
  return !!store && store.version === 1
    && Array.isArray(store.candidates)
    && Array.isArray(store.memories)
    && Array.isArray(store.families)
    && Array.isArray(store.memberships)
    && Array.isArray(store.changes)
}

function readStore(): StarMemoryStore {
  return readJsonFile(STORE_FILE, { fallback: emptyStore, validate: validStore })
}

function updateStore(update: (store: StarMemoryStore) => StarMemoryStore): StarMemoryStore {
  return updateJsonFile(STORE_FILE, { fallback: emptyStore, validate: validStore }, update)
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

function change(actorValue: MemoryActor, action: string, targetId: string, now: string): ChangeRecord {
  return { id: randomUUID(), actor: actorValue, action, targetId, createdAt: now }
}

export function getStarMemoryStatus() {
  const store = readStore()
  return {
    version: store.version,
    candidates: store.candidates.length,
    pendingStar: store.candidates.filter(item => item.status === 'pending_star').length,
    pendingFire: store.candidates.filter(item => item.status === 'pending_fire').length,
    memories: store.memories.length,
    families: store.families.length,
  }
}

export function listMemoryCandidates(status?: CandidateStatus): MemoryCandidate[] {
  const items = readStore().candidates
  return (status ? items.filter(item => item.status === status) : items)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function createMemoryCandidate(input: unknown, createdByValue: unknown, ownerValue: unknown = 'star'): MemoryCandidate {
  const createdBy = actor(createdByValue)
  const owner = reviewer(ownerValue)
  const value = draft(input)
  const raw = input as MemoryDraft & { familyIds?: unknown[] }
  const suggestedFamilyIds = Array.isArray(raw.familyIds)
    ? Array.from(new Set(raw.familyIds.map(id => text(id, 'familyId', 100, true)!)))
    : []
  const now = new Date().toISOString()
  const candidate: MemoryCandidate = {
    ...value,
    id: randomUUID(),
    status: owner === 'fire' ? 'pending_fire' : 'pending_star',
    owner,
    createdBy,
    createdAt: now,
    updatedAt: now,
    suggestedFamilyIds,
  }
  updateStore(store => ({
    ...store,
    candidates: [...store.candidates, candidate],
    changes: [...store.changes, change(createdBy, 'candidate.created', candidate.id, now)],
  }))
  return candidate
}

function familyDepth(store: StarMemoryStore, parentId?: string): number {
  if (!parentId) return 1
  const seen = new Set<string>()
  let current = store.families.find(item => item.id === parentId)
  let depth = 1
  while (current) {
    if (seen.has(current.id)) throw new Error('family hierarchy has a cycle')
    seen.add(current.id)
    depth += 1
    current = current.parentId ? store.families.find(item => item.id === current!.parentId) : undefined
  }
  if (!seen.has(parentId)) throw new Error('parent family not found')
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
  let created!: MemoryFamily
  updateStore(store => {
    if (familyDepth(store, parentId) > 3) throw new Error('family nesting cannot exceed three levels')
    if (store.families.some(item => item.parentId === parentId && item.name.toLowerCase() === name.toLowerCase())) {
      throw new Error('family name already exists at this level')
    }
    const now = new Date().toISOString()
    created = { id: randomUUID(), name, title, summary, status, parentId, locked: !!raw.locked, createdBy, createdAt: now, updatedAt: now }
    return {
      ...store,
      families: [...store.families, created],
      changes: [...store.changes, change(createdBy, 'family.created', created.id, now)],
    }
  })
  return created
}

export function listMemoryFamilies(): Array<MemoryFamily & { memberCount: number }> {
  const store = readStore()
  return store.families.map(family => ({
    ...family,
    memberCount: store.memberships.filter(item => item.familyId === family.id).length,
  })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export function getMemoryFamily(id: string) {
  const store = readStore()
  const family = store.families.find(item => item.id === id)
  if (!family) return null
  const memberships = store.memberships.filter(item => item.familyId === id)
  const memoryIds = new Set(memberships.map(item => item.memoryId))
  return {
    ...family,
    children: store.families.filter(item => item.parentId === id),
    memberships,
    memories: store.memories.filter(item => memoryIds.has(item.id)),
  }
}

export type CandidateDecision = 'approve' | 'reject' | 'observe' | 'assign_fire' | 'assign_star'

export function reviewMemoryCandidate(idValue: unknown, decision: CandidateDecision, reviewerValue: unknown, familyIdsValue?: unknown) {
  const id = text(idValue, 'candidate id', 100, true)!
  const approvedBy = reviewer(reviewerValue)
  const allowed = new Set<CandidateDecision>(['approve', 'reject', 'observe', 'assign_fire', 'assign_star'])
  if (!allowed.has(decision)) throw new Error('candidate decision is invalid')
  let result!: { candidate: MemoryCandidate; memory?: CanonicalMemory }
  updateStore(store => {
    const index = store.candidates.findIndex(item => item.id === id)
    if (index < 0) throw new Error('candidate not found')
    const current = store.candidates[index]
    if (current.status === 'approved' || current.status === 'rejected') throw new Error('candidate is already final')
    const now = new Date().toISOString()
    const candidate = { ...current, updatedAt: now }
    const candidates = [...store.candidates]
    if (decision === 'reject') candidate.status = 'rejected'
    if (decision === 'observe') candidate.status = 'observing'
    if (decision === 'assign_fire') { candidate.status = 'pending_fire'; candidate.owner = 'fire' }
    if (decision === 'assign_star') { candidate.status = 'pending_star'; candidate.owner = 'star' }
    if (decision !== 'approve') {
      candidates[index] = candidate
      result = { candidate }
      return { ...store, candidates, changes: [...store.changes, change(approvedBy, `candidate.${decision}`, id, now)] }
    }

    const requestedIds = Array.isArray(familyIdsValue)
      ? Array.from(new Set(familyIdsValue.map(value => text(value, 'familyId', 100, true)!)))
      : current.suggestedFamilyIds
    for (const familyId of requestedIds) {
      if (!store.families.some(item => item.id === familyId)) throw new Error(`family not found: ${familyId}`)
    }
    const manualByFire = current.sources.some(source => source.kind === 'manual' && source.actor === 'fire')
    const memory: CanonicalMemory = {
      ...draft(current),
      id: randomUUID(),
      locked: manualByFire || !!current.locked,
      createdBy: current.createdBy,
      approvedBy,
      createdAt: now,
      status: 'active',
    }
    candidate.status = 'approved'
    candidate.memoryId = memory.id
    candidates[index] = candidate
    const memberships = requestedIds.map((familyId): FamilyMembership => ({
      familyId,
      memoryId: memory.id,
      role: current.type === 'shared_event' || current.type === 'self_event' ? 'key_event'
        : current.type === 'unresolved' ? 'unresolved'
          : 'member',
      addedBy: approvedBy,
      createdAt: now,
    }))
    result = { candidate, memory }
    return {
      ...store,
      candidates,
      memories: [...store.memories, memory],
      memberships: [...store.memberships, ...memberships],
      changes: [...store.changes, change(approvedBy, 'candidate.approved', id, now)],
    }
  })
  return result
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
  const store = readStore()
  const now = new Date().toISOString()
  const familyScores = new Map(store.families.map(family => [
    family.id,
    relevance(`${family.name} ${family.title || ''} ${family.summary || ''}`, query),
  ]))
  return store.memories.map(memory => {
    const memberships = store.memberships.filter(item => item.memoryId === memory.id)
    const families = memberships.map(link => store.families.find(item => item.id === link.familyId)).filter((item): item is MemoryFamily => !!item)
    const memoryText = [memory.summary, memory.details, memory.whyImportant, memory.currentUnderstanding, ...(memory.quotes || []).map(item => item.text)].filter(Boolean).join(' ')
    const direct = relevance(memoryText, query)
    const family = Math.max(0, ...families.map(item => familyScores.get(item.id) || 0)) * 0.85
    const base = Math.max(direct, family)
    const current = !memory.validTo || memory.validTo >= now
    const score = base > 0 ? base + (memory.importance || 5) * 2 + (current ? 10 : 0) : 0
    return { memory, families, score: Number(score.toFixed(2)), match: direct >= family ? 'memory' : 'family', current }
  }).filter(item => item.score >= 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

export function resolveMemorySources(memoryIdValue: unknown) {
  const memoryId = text(memoryIdValue, 'memory id', 100, true)!
  const memory = readStore().memories.find(item => item.id === memoryId)
  if (!memory) throw new Error('memory not found')
  return memory.sources.map(source => {
    if (source.kind !== 'chat' || !source.sessionId) return { source, resolved: source.excerpt ? [{ content: source.excerpt }] : [] }
    const session = readChatSession(source.sessionId) as any
    const wanted = new Set(source.messageIds || [])
    const resolved = Array.isArray(session?.messages)
      ? session.messages.filter((message: any) => wanted.has(String(message?.id || ''))).map((message: any) => ({
        id: String(message.id),
        role: message.role,
        content: String(message.content || ''),
        timestamp: Number(message.timestamp) || 0,
      }))
      : []
    return { source, resolved, missing: resolved.length !== wanted.size }
  })
}
