/**
 * OmbreBrain v2.0 — Local memory engine for Lumbre.
 * Replaces external proxy to xiaohuo.zeabur.app.
 * Stores buckets as JSON in /persistent/buckets/.
 */
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR || '/persistent'
const BUCKETS_DIR = path.join(DATA_DIR, 'buckets')
const INDEX_FILE = path.join(BUCKETS_DIR, '_index.json')
const BRAIN_CONFIG_FILE = path.join(DATA_DIR, 'brain-config.json')

// ── Types ──

export interface BucketMeta {
  id: string
  name: string
  type: string          // dynamic | permanent | feel | anchor | plan | letter
  domain: string[]
  tags: string[]
  valence: number       // 0-1
  arousal: number       // 0-1
  importance: number    // 1-10
  resolved: boolean
  pinned: boolean
  digested: boolean
  created: string       // ISO datetime
  last_active: string   // ISO datetime
  activation_count: number
  model_valence?: number | null
}

export interface Bucket {
  id: string
  metadata: BucketMeta
  content: string
  score: number
}

export interface IndexEntry {
  id: string
  name: string
  type: string
  domain: string[]
  tags: string[]
  valence: number
  arousal: number
  model_valence?: number | null
  importance: number
  resolved: boolean
  pinned: boolean
  digested: boolean
  created: string
  last_active: string
  activation_count: number
  score: number
  content_preview: string
}

export interface BrainConfig {
  dehydration?: {
    model?: string
    base_url?: string
    api_key?: string
    max_tokens?: number
    temperature?: number
  }
  embedding?: {
    enabled?: boolean
    model?: string
    api_key?: string
  }
  merge_threshold?: number
  decay?: { lambda?: number }
}

// ── Helpers ──

function ensureDir() {
  fs.mkdirSync(BUCKETS_DIR, { recursive: true })
}

function bucketPath(id: string): string {
  return path.join(BUCKETS_DIR, `${id}.json`)
}

function generateId(): string {
  const bytes = new Uint8Array(6)
  for (let i = 0; i < 6; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function preview(content: string, maxLen = 200): string {
  return content.length > maxLen ? content.slice(0, maxLen) + '…' : content
}

function computeScore(meta: BucketMeta): number {
  if (meta.pinned) return 999.0
  if (meta.type === 'anchor') return 998.0

  const now = Date.now()
  const lastActive = new Date(meta.last_active).getTime()
  const hoursSince = Math.max(0, (now - lastActive) / 3600000)

  // Ebbinghaus-inspired decay
  const lambda = 0.05
  const emotionIntensity = Math.abs(meta.valence - 0.5) * 2 + meta.arousal
  const decayRate = lambda / (1 + emotionIntensity * 0.5)
  const retention = Math.exp(-decayRate * hoursSince)

  const importanceWeight = meta.importance / 10
  const unresolvedBoost = meta.resolved ? 0 : 0.2
  const activationBoost = Math.min(meta.activation_count * 0.02, 0.3)

  return Number(((importanceWeight * 0.4 + retention * 0.3 + unresolvedBoost + activationBoost) * 10).toFixed(2))
}

// ── In-memory cache ──

let bucketCache: Map<string, Bucket> | null = null
let cacheLoadedAt = 0

function invalidateCache() {
  bucketCache = null
}

// ── Core CRUD ──

export function loadAllBuckets(): Bucket[] {
  ensureDir()
  if (bucketCache && Date.now() - cacheLoadedAt < 30000) {
    return Array.from(bucketCache.values())
  }

  const files = fs.readdirSync(BUCKETS_DIR).filter(f => f.endsWith('.json') && f !== '_index.json')
  const map = new Map<string, Bucket>()

  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(BUCKETS_DIR, file), 'utf-8'))
      const bucket = normalizeBucket(raw)
      if (bucket) map.set(bucket.id, bucket)
    } catch { /* skip corrupt files */ }
  }

  bucketCache = map
  cacheLoadedAt = Date.now()
  return Array.from(map.values())
}

function normalizeBucket(raw: any): Bucket | null {
  if (!raw || !raw.id) return null

  // Support both formats: {id, metadata, content, score} and flat {id, name, ...}
  if (raw.metadata) {
    return {
      id: raw.id,
      metadata: {
        id: raw.id,
        name: raw.metadata.name || '',
        type: raw.metadata.type || 'dynamic',
        domain: raw.metadata.domain || ['未分类'],
        tags: raw.metadata.tags || [],
        valence: raw.metadata.valence ?? 0.5,
        arousal: raw.metadata.arousal ?? 0.5,
        importance: raw.metadata.importance ?? 5,
        resolved: raw.metadata.resolved ?? false,
        pinned: raw.metadata.pinned ?? false,
        digested: raw.metadata.digested ?? false,
        created: raw.metadata.created || new Date().toISOString(),
        last_active: raw.metadata.last_active || raw.metadata.created || new Date().toISOString(),
        activation_count: raw.metadata.activation_count ?? 0,
        model_valence: raw.metadata.model_valence ?? null,
      },
      content: raw.content || '',
      score: raw.score ?? 0,
    }
  }

  // Flat format (from _index.json style)
  return {
    id: raw.id,
    metadata: {
      id: raw.id,
      name: raw.name || '',
      type: raw.type || 'dynamic',
      domain: raw.domain || ['未分类'],
      tags: raw.tags || [],
      valence: raw.valence ?? 0.5,
      arousal: raw.arousal ?? 0.5,
      importance: raw.importance ?? 5,
      resolved: raw.resolved ?? false,
      pinned: raw.pinned ?? false,
      digested: raw.digested ?? false,
      created: raw.created || new Date().toISOString(),
      last_active: raw.last_active || raw.created || new Date().toISOString(),
      activation_count: raw.activation_count ?? 0,
      model_valence: raw.model_valence ?? null,
    },
    content: raw.content || raw.content_preview || '',
    score: raw.score ?? 0,
  }
}

export function getBucket(id: string): Bucket | null {
  const all = loadAllBuckets()
  return bucketCache?.get(id) || null
}

export function saveBucket(bucket: Bucket): void {
  ensureDir()
  bucket.score = computeScore(bucket.metadata)
  fs.writeFileSync(bucketPath(bucket.id), JSON.stringify(bucket, null, 2))
  if (bucketCache) {
    bucketCache.set(bucket.id, bucket)
  }
}

export function deleteBucket(id: string): boolean {
  const fp = bucketPath(id)
  if (!fs.existsSync(fp)) return false
  fs.unlinkSync(fp)
  if (bucketCache) bucketCache.delete(id)
  return true
}

export function archiveBucket(id: string): boolean {
  const bucket = getBucket(id)
  if (!bucket) return false
  bucket.metadata.resolved = true
  bucket.metadata.digested = true
  saveBucket(bucket)
  return true
}

// ── Index ──

export function buildIndex(): IndexEntry[] {
  const all = loadAllBuckets()
  const entries: IndexEntry[] = all.map(b => ({
    id: b.id,
    name: b.metadata.name,
    type: b.metadata.type,
    domain: b.metadata.domain,
    tags: b.metadata.tags,
    valence: b.metadata.valence,
    arousal: b.metadata.arousal,
    model_valence: b.metadata.model_valence,
    importance: b.metadata.importance,
    resolved: b.metadata.resolved,
    pinned: b.metadata.pinned,
    digested: b.metadata.digested,
    created: b.metadata.created,
    last_active: b.metadata.last_active,
    activation_count: b.metadata.activation_count,
    score: b.score,
    content_preview: preview(b.content),
  }))
  entries.sort((a, b) => b.score - a.score)
  try { fs.writeFileSync(INDEX_FILE, JSON.stringify(entries, null, 2)) } catch {}
  return entries
}

// ── Search ──

function fuzzyMatch(text: string, query: string): number {
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  if (lower.includes(q)) return 100
  // Simple word overlap scoring
  const words = q.split(/\s+/)
  let matches = 0
  for (const w of words) {
    if (lower.includes(w)) matches++
  }
  return words.length > 0 ? (matches / words.length) * 80 : 0
}

export function searchBuckets(query: string, limit = 20): Bucket[] {
  if (!query.trim()) {
    // Return top buckets by score
    const all = loadAllBuckets()
    return all.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  const all = loadAllBuckets()
  const scored: { bucket: Bucket; matchScore: number }[] = []

  for (const b of all) {
    const nameScore = fuzzyMatch(b.metadata.name, query)
    const contentScore = fuzzyMatch(b.content, query) * 0.8
    const tagScore = fuzzyMatch(b.metadata.tags.join(' '), query) * 0.6
    const best = Math.max(nameScore, contentScore, tagScore)
    if (best > 20) {
      scored.push({ bucket: b, matchScore: best })
    }
  }

  scored.sort((a, b) => b.matchScore - a.matchScore)
  return scored.slice(0, limit).map(s => s.bucket)
}

// ── Breath (memory surfacing) ──

export interface BreathResult {
  buckets: Bucket[]
  total: number
  query?: string
}

export function breath(opts: {
  query?: string
  domain?: string
  valence?: number
  arousal?: number
  importance_min?: number
  max_results?: number
  max_tokens?: number
}): BreathResult {
  let candidates = loadAllBuckets()

  // Filter by domain
  if (opts.domain) {
    const domains = opts.domain.split(',').map(d => d.trim().toLowerCase())
    candidates = candidates.filter(b =>
      b.metadata.domain.some(d => domains.includes(d.toLowerCase()))
    )
  }

  // Filter by importance_min
  if (opts.importance_min && opts.importance_min >= 1) {
    candidates = candidates.filter(b => b.metadata.importance >= opts.importance_min!)
    candidates.sort((a, b) => b.metadata.importance - a.metadata.importance)
    return {
      buckets: candidates.slice(0, opts.max_results || 20),
      total: candidates.length,
      query: opts.query,
    }
  }

  // If query provided, do search
  if (opts.query) {
    const results = searchBuckets(opts.query, opts.max_results || 20)
    return { buckets: results, total: results.length, query: opts.query }
  }

  // Default: surface unresolved high-weight buckets
  candidates = candidates.filter(b => !b.metadata.resolved && !b.metadata.digested)
  candidates.sort((a, b) => b.score - a.score)
  return {
    buckets: candidates.slice(0, opts.max_results || 20),
    total: candidates.length,
  }
}

// ── Breath Debug ──

export interface BreathDebugEntry {
  id: string
  name: string
  scores: {
    topic: number
    emotion: number
    time: number
    importance: number
    total: number
  }
  passed: boolean
}

export function breathDebug(query: string, valence?: number, arousal?: number): BreathDebugEntry[] {
  const all = loadAllBuckets()
  return all.map(b => {
    const topicScore = query ? fuzzyMatch(b.metadata.name + ' ' + b.content, query) / 100 : 0.5
    const emotionScore = valence !== undefined
      ? 1 - Math.abs(b.metadata.valence - valence)
      : 0.5
    const arousalScore = arousal !== undefined
      ? 1 - Math.abs(b.metadata.arousal - arousal)
      : 0.5
    const now = Date.now()
    const lastActive = new Date(b.metadata.last_active).getTime()
    const hoursSince = (now - lastActive) / 3600000
    const timeScore = Math.exp(-0.02 * hoursSince)
    const importanceScore = b.metadata.importance / 10

    const total = topicScore * 0.35 + emotionScore * 0.15 + timeScore * 0.25 + importanceScore * 0.25

    return {
      id: b.id,
      name: b.metadata.name,
      scores: {
        topic: Number(topicScore.toFixed(3)),
        emotion: Number(emotionScore.toFixed(3)),
        time: Number(timeScore.toFixed(3)),
        importance: Number(importanceScore.toFixed(3)),
        total: Number(total.toFixed(3)),
      },
      passed: total > 0.3,
    }
  }).sort((a, b) => b.scores.total - a.scores.total)
}

// ── Edit ──

export function editBucket(id: string, changes: Partial<BucketMeta> & { content?: string }): Bucket | null {
  const bucket = getBucket(id)
  if (!bucket) return null

  if (changes.name !== undefined) bucket.metadata.name = changes.name
  if (changes.importance !== undefined) bucket.metadata.importance = changes.importance
  if (changes.valence !== undefined) bucket.metadata.valence = changes.valence
  if (changes.arousal !== undefined) bucket.metadata.arousal = changes.arousal
  if (changes.tags !== undefined) bucket.metadata.tags = changes.tags
  if (changes.domain !== undefined) bucket.metadata.domain = changes.domain
  if (changes.pinned !== undefined) bucket.metadata.pinned = changes.pinned
  if (changes.resolved !== undefined) bucket.metadata.resolved = changes.resolved
  if (changes.digested !== undefined) bucket.metadata.digested = changes.digested
  if (changes.type !== undefined) bucket.metadata.type = changes.type
  if (changes.content !== undefined) bucket.content = changes.content

  bucket.metadata.last_active = new Date().toISOString()
  saveBucket(bucket)
  return bucket
}

// ── Pin / Resolve toggles ──

export function togglePin(id: string): Bucket | null {
  const bucket = getBucket(id)
  if (!bucket) return null
  bucket.metadata.pinned = !bucket.metadata.pinned
  if (bucket.metadata.pinned) bucket.metadata.type = 'permanent'
  saveBucket(bucket)
  return bucket
}

export function toggleResolve(id: string): Bucket | null {
  const bucket = getBucket(id)
  if (!bucket) return null
  bucket.metadata.resolved = !bucket.metadata.resolved
  saveBucket(bucket)
  return bucket
}

// ── Hold (create new bucket) ──

export function holdBucket(content: string, opts?: {
  tags?: string
  importance?: number
  pinned?: boolean
  feel?: boolean
  valence?: number
  arousal?: number
  source_bucket?: string
}): Bucket {
  const id = generateId()
  const now = new Date().toISOString()
  const tags = opts?.tags ? opts.tags.split(',').map(t => t.trim()).filter(Boolean) : []

  const bucket: Bucket = {
    id,
    metadata: {
      id,
      name: content.slice(0, 50).replace(/\n/g, ' '),
      type: opts?.feel ? 'feel' : opts?.pinned ? 'permanent' : 'dynamic',
      domain: ['未分类'],
      tags,
      valence: opts?.valence ?? 0.5,
      arousal: opts?.arousal ?? 0.5,
      importance: opts?.importance ?? 5,
      resolved: false,
      pinned: opts?.pinned ?? false,
      digested: false,
      created: now,
      last_active: now,
      activation_count: 0,
    },
    content,
    score: 0,
  }

  saveBucket(bucket)
  return bucket
}

// ── Grow (split long content) ──

export function growBuckets(content: string): Bucket[] {
  // Simple paragraph-based splitting
  const paragraphs = content.split(/\n{2,}/).filter(p => p.trim().length > 10)
  if (paragraphs.length <= 1) {
    return [holdBucket(content)]
  }

  return paragraphs.slice(0, 6).map(p => holdBucket(p.trim()))
}

// ── Trace (modify metadata) ──

export function traceBucket(id: string, changes: {
  resolved?: number       // 1=resolve, 0=activate
  pinned?: number         // 1=pin, 0=unpin
  digested?: number       // 1=hide, 0=unhide
  content?: string
  name?: string
  importance?: number
  valence?: number
  arousal?: number
  tags?: string
  domain?: string
  delete?: boolean
}): { ok: boolean; bucket?: Bucket } {
  if (changes.delete) {
    return { ok: deleteBucket(id) }
  }

  const bucket = getBucket(id)
  if (!bucket) return { ok: false }

  if (changes.resolved !== undefined && changes.resolved !== -1) {
    bucket.metadata.resolved = changes.resolved === 1
  }
  if (changes.pinned !== undefined && changes.pinned !== -1) {
    bucket.metadata.pinned = changes.pinned === 1
    if (bucket.metadata.pinned) bucket.metadata.type = 'permanent'
  }
  if (changes.digested !== undefined && changes.digested !== -1) {
    bucket.metadata.digested = changes.digested === 1
  }
  if (changes.content !== undefined) bucket.content = changes.content
  if (changes.name !== undefined) bucket.metadata.name = changes.name
  if (changes.importance !== undefined) bucket.metadata.importance = changes.importance
  if (changes.valence !== undefined && changes.valence >= 0) bucket.metadata.valence = changes.valence
  if (changes.arousal !== undefined && changes.arousal >= 0) bucket.metadata.arousal = changes.arousal
  if (changes.tags !== undefined) {
    bucket.metadata.tags = changes.tags.split(',').map(t => t.trim()).filter(Boolean)
  }
  if (changes.domain !== undefined) {
    bucket.metadata.domain = changes.domain.split(',').map(d => d.trim()).filter(Boolean)
  }

  bucket.metadata.last_active = new Date().toISOString()
  saveBucket(bucket)
  return { ok: true, bucket }
}

// ── Dream (digest recent changes) ──

export function dream(windowHours = 48): Bucket[] {
  const cutoff = Date.now() - windowHours * 3600000
  const all = loadAllBuckets()
  return all
    .filter(b => new Date(b.metadata.last_active).getTime() > cutoff)
    .sort((a, b) => new Date(b.metadata.last_active).getTime() - new Date(a.metadata.last_active).getTime())
}

// ── Pulse (system status) ──

export function pulse(): {
  total: number
  pinned: number
  resolved: number
  unresolved: number
  feel: number
  domains: Record<string, number>
  types: Record<string, number>
  buckets: IndexEntry[]
} {
  const entries = buildIndex()
  const all = loadAllBuckets()

  const domains: Record<string, number> = {}
  const types: Record<string, number> = {}
  let pinned = 0, resolved = 0, unresolved = 0, feel = 0

  for (const b of all) {
    if (b.metadata.pinned) pinned++
    if (b.metadata.resolved) resolved++
    else unresolved++
    if (b.metadata.type === 'feel') feel++
    for (const d of b.metadata.domain) {
      domains[d] = (domains[d] || 0) + 1
    }
    types[b.metadata.type] = (types[b.metadata.type] || 0) + 1
  }

  return {
    total: all.length,
    pinned, resolved, unresolved, feel,
    domains, types,
    buckets: entries,
  }
}

// ── Config ──

export function getConfig(): BrainConfig {
  try {
    return JSON.parse(fs.readFileSync(BRAIN_CONFIG_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

export function saveConfig(config: BrainConfig): void {
  fs.writeFileSync(BRAIN_CONFIG_FILE, JSON.stringify(config, null, 2))
}

// ── Status ──

export function getStatus() {
  const all = loadAllBuckets()
  let totalSize = 0
  try {
    const files = fs.readdirSync(BUCKETS_DIR)
    for (const f of files) {
      try { totalSize += fs.statSync(path.join(BUCKETS_DIR, f)).size } catch {}
    }
  } catch {}

  return {
    version: '2.0.0-lumbre',
    bucket_count: all.length,
    data_dir: BUCKETS_DIR,
    data_size_mb: Number((totalSize / 1048576).toFixed(2)),
    decay_engine: 'ebbinghaus-v2',
    vector_search: false,
    persistent: true,
  }
}

// ── Network (basic tag similarity) ──

export function getNetwork(limit = 50) {
  const all = loadAllBuckets().slice(0, 200) // cap for performance
  const nodes = all.slice(0, limit).map(b => ({
    id: b.id,
    name: b.metadata.name,
    importance: b.metadata.importance,
    domain: b.metadata.domain,
    valence: b.metadata.valence,
  }))

  // Build edges based on tag overlap
  const edges: { source: string; target: string; weight: number }[] = []
  for (let i = 0; i < nodes.length; i++) {
    const bi = all.find(b => b.id === nodes[i].id)!
    for (let j = i + 1; j < nodes.length; j++) {
      const bj = all.find(b => b.id === nodes[j].id)!
      const shared = bi.metadata.tags.filter(t => bj.metadata.tags.includes(t))
      if (shared.length >= 2) {
        edges.push({
          source: bi.id,
          target: bj.id,
          weight: shared.length / Math.max(bi.metadata.tags.length, bj.metadata.tags.length, 1),
        })
      }
    }
  }

  return { nodes, edges }
}

// ── Purge (permanent delete multiple) ──

export function purgeBuckets(ids: string[]): { deleted: number; errors: string[] } {
  let deleted = 0
  const errors: string[] = []
  for (const id of ids) {
    if (deleteBucket(id)) deleted++
    else errors.push(id)
  }
  return { deleted, errors }
}
