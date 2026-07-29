import fs from 'fs'
import path from 'path'

export type Actor = 'star' | 'fire'
export type ScoreKey = 'foreplay' | 'penetration' | 'orgasm' | 'aftercare' | 'atmosphere' | 'talk'
export interface IntimacyScores { star: Record<ScoreKey, number>; fire: Record<ScoreKey, number> }
export interface IntimacyAudit { id: string; action: 'create' | 'update' | 'delete'; actor: Actor; at: string; changes?: string[]; snapshot?: Partial<IntimacyRecord> }
export interface IntimacyRecord {
  id: string
  date: string
  time_start: string
  duration_min: number
  rounds: number
  positions: string[]
  initiated_by: Actor
  star_notes: string
  fire_notes: string
  tags: string[]
  scores: IntimacyScores
  encore: string[]
  role_play?: string
  created_at: string
  updated_at: string
  created_by: Actor
  audit: IntimacyAudit[]
}
interface Store { records: IntimacyRecord[] }

const ROOT = process.env.DATA_DIR || '/persistent'
const DIR = path.join(ROOT, 'intimacy')
const FILE = path.join(DIR, 'records.json')
const SCORE_KEYS: ScoreKey[] = ['foreplay', 'penetration', 'orgasm', 'aftercare', 'atmosphere', 'talk']
const SAFE_ROLE_PLAYS = ['陌生人', '师生（均为成年人）', '上司与下属', '医生与病人', '审讯者与嫌疑人', '主人与服从者（均为成年人）', '角色互换', '制服', '其他']

function uid(prefix: string) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }
function ensure() { fs.mkdirSync(DIR, { recursive: true }); if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({ records: [] }, null, 2)) }
function load(): Store { ensure(); try { const x = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { records: Array.isArray(x.records) ? x.records : [] } } catch { return { records: [] } } }
function save(s: Store) { ensure(); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(s, null, 2)); fs.renameSync(tmp, FILE) }
function arr(v: any): string[] { return Array.isArray(v) ? v.map(String).map(x => x.trim()).filter(Boolean) : typeof v === 'string' ? v.split(/[,，]/).map(x => x.trim()).filter(Boolean) : [] }
function actor(v: any): Actor { return v === 'star' ? 'star' : 'fire' }
function clamp(v: any, min: number, max: number, fallback: number) { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : fallback }
function scores(v: any): IntimacyScores {
  const out: any = { star: {}, fire: {} }
  for (const who of ['star', 'fire'] as Actor[]) for (const k of SCORE_KEYS) out[who][k] = clamp(v?.[who]?.[k], 0, 10, 0)
  return out
}
function cleanRolePlay(v: any): string | undefined {
  const x = String(v || '').trim()
  if (!x) return undefined
  const blocked = /(母子|父女|兄妹|姐弟|姐夫|嫂子|继父|继母|叔侄|姑侄|亲属|未成年)/
  if (blocked.test(x)) return undefined
  return x.slice(0, 80)
}
function normalize(input: any, base?: IntimacyRecord): IntimacyRecord {
  const now = new Date().toISOString()
  return {
    id: base?.id || uid('intimacy'), date: String(input.date ?? base?.date ?? now.slice(0, 10)).slice(0, 10),
    time_start: String(input.time_start ?? base?.time_start ?? '00:00').slice(0, 5),
    duration_min: clamp(input.duration_min ?? base?.duration_min, 0, 1440, 0), rounds: clamp(input.rounds ?? base?.rounds, 0, 99, 1),
    positions: arr(input.positions ?? base?.positions), initiated_by: actor(input.initiated_by ?? base?.initiated_by),
    star_notes: String(input.star_notes ?? base?.star_notes ?? '').slice(0, 4000), fire_notes: String(input.fire_notes ?? base?.fire_notes ?? '').slice(0, 4000),
    tags: arr(input.tags ?? base?.tags), scores: scores(input.scores ?? base?.scores), encore: arr(input.encore ?? base?.encore),
    role_play: cleanRolePlay(input.role_play ?? base?.role_play), created_at: base?.created_at || now, updated_at: now,
    created_by: base?.created_by || actor(input.actor || input.created_by), audit: base?.audit || [],
  }
}

export function listIntimacyRecords() { return load().records.slice().sort((a, b) => `${b.date}T${b.time_start}`.localeCompare(`${a.date}T${a.time_start}`)) }
export function createIntimacyRecord(input: any, by: Actor): IntimacyRecord {
  const s = load(); const r = normalize({ ...input, actor: by }); r.audit.push({ id: uid('audit'), action: 'create', actor: by, at: r.created_at, snapshot: { date: r.date, time_start: r.time_start, rounds: r.rounds } }); s.records.push(r); save(s); return r
}
export function updateIntimacyRecord(id: string, patch: any, by: Actor): IntimacyRecord | null {
  const s = load(); const i = s.records.findIndex(r => r.id === id); if (i < 0) return null
  const before = s.records[i]; const next = normalize(patch, before); const changes = Object.keys(patch).filter(k => !['id', 'actor', 'audit'].includes(k)); next.audit = [...(before.audit || []), { id: uid('audit'), action: 'update', actor: by, at: next.updated_at, changes }]; s.records[i] = next; save(s); return next
}
export function deleteIntimacyRecord(id: string, by: Actor): boolean {
  const s = load(); const i = s.records.findIndex(r => r.id === id); if (i < 0) return false
  const r = s.records[i]; const deleted = loadDeletedIntimacyRecords(); deleted.push({ ...r, deleted_at: new Date().toISOString(), deleted_by: by, audit: [...(r.audit || []), { id: uid('audit'), action: 'delete', actor: by, at: new Date().toISOString() }] }); saveDeleted(deleted); s.records.splice(i, 1); save(s); return true
}
function deletedFile() { return path.join(DIR, 'deleted.json') }
export function loadDeletedIntimacyRecords(): any[] { try { return JSON.parse(fs.readFileSync(deletedFile(), 'utf8')) || [] } catch { return [] } }
function saveDeleted(x: any[]) { fs.writeFileSync(deletedFile(), JSON.stringify(x, null, 2)) }
export function listIntimacyActivity() {
  const active = listIntimacyRecords().reduce((all: any[], r) => all.concat((r.audit || []).map(a => ({ ...a, record_id: r.id, record_date: r.date }))), [])
  const deleted = loadDeletedIntimacyRecords().reduce((all: any[], r: any) => all.concat((r.audit || []).map((a: any) => ({ ...a, record_id: r.id, record_date: r.date, deleted: true }))), [])
  return active.concat(deleted).sort((a: any, b: any) => String(b.at).localeCompare(String(a.at))).slice(0, 200)
}
export function intimacyOptions() { return { score_keys: SCORE_KEYS, role_play_options: SAFE_ROLE_PLAYS } }
