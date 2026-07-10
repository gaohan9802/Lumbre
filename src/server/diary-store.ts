/**
 * Local file-based storage for diaries and notes.
 * On first boot, seeds from bundled JSON files (src/seed/) into per-file storage.
 */
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR || '/persistent'
const DIARY_DIR = path.join(DATA_DIR, 'diaries')
const NOTES_DIR = path.join(DATA_DIR, 'notes')
const CONFIG_FILE = path.join(DATA_DIR, 'config.json')

function ensureDirs() {
  for (const dir of [DIARY_DIR, NOTES_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

// ── Auto-migration / seeding ────────────────────────────

function findSeedFile(name: string): string | null {
  // Check DATA_DIR first (legacy combined files)
  const inData = path.join(DATA_DIR, name)
  if (fs.existsSync(inData)) return inData
  // Check bundled seed directory (shipped with git)
  const inSeed = path.join(process.cwd(), 'src', 'seed', name)
  if (fs.existsSync(inSeed)) return inSeed
  // Standalone build puts files in .next/server/ area
  const inStandalone = path.join(__dirname, '..', '..', 'seed', name)
  if (fs.existsSync(inStandalone)) return inStandalone
  return null
}

function migrateIfNeeded() {
  ensureDirs()

  // Migrate diaries
  const existing = fs.readdirSync(DIARY_DIR).filter(f => f.endsWith('.json'))
  if (existing.length === 0) {
    const seedPath = findSeedFile('diaries.json')
    if (seedPath) {
      try {
        const entries = JSON.parse(fs.readFileSync(seedPath, 'utf-8'))
        for (const entry of entries) {
          const filename = `${entry.date}_${entry.time_id}_${entry.author}.json`
          fs.writeFileSync(path.join(DIARY_DIR, filename), JSON.stringify(entry, null, 2), 'utf-8')
        }
        console.log(`[diary-store] Seeded ${entries.length} diaries from ${seedPath}`)
      } catch (e) {
        console.error('[diary-store] Failed to seed diaries:', e)
      }
    }
  }

  // Migrate notes
  const existingNotes = fs.readdirSync(NOTES_DIR).filter(f => f.endsWith('.json'))
  if (existingNotes.length === 0) {
    const seedPath = findSeedFile('notes.json')
    if (seedPath) {
      try {
        const notes = JSON.parse(fs.readFileSync(seedPath, 'utf-8'))
        for (const note of notes) {
          fs.writeFileSync(path.join(NOTES_DIR, `${note.id}.json`), JSON.stringify(note, null, 2), 'utf-8')
        }
        console.log(`[diary-store] Seeded ${notes.length} notes from ${seedPath}`)
      } catch (e) {
        console.error('[diary-store] Failed to seed notes:', e)
      }
    }
  }
}

// Run migration on module load
migrateIfNeeded()

function loadConfig(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'))
  } catch {
    return { passwords: {} }
  }
}

function saveConfig(config: Record<string, any>) {
  ensureDirs()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
}

export function setPassword(author: string, password: string) {
  const config = loadConfig()
  if (!config.passwords) config.passwords = {}
  config.passwords[author] = password
  saveConfig(config)
}

export function checkPassword(author: string, password: string): boolean {
  const config = loadConfig()
  const correct = config.passwords?.[author]
  if (!correct) return false
  return password === correct
}

export function hasPassword(author: string): boolean {
  const config = loadConfig()
  return !!config.passwords?.[author]
}

// ── Diary ───────────────────────────────────────────────

export interface DiaryEntry {
  date: string
  author: string
  title: string
  content: string
  type?: string
  visibility: string
  reveal_at?: string | null
  tags: string[]
  comments: { author: string; content: string; time: string }[]
  time_id: string
  created_at: string
  updated_at: string | null
}

function listAllDiaries(): DiaryEntry[] {
  ensureDirs()
  const entries: DiaryEntry[] = []
  for (const file of fs.readdirSync(DIARY_DIR).filter(f => f.endsWith('.json'))) {
    try {
      entries.push(JSON.parse(fs.readFileSync(path.join(DIARY_DIR, file), 'utf-8')))
    } catch {}
  }
  entries.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  return entries
}

function saveDiary(entry: DiaryEntry) {
  ensureDirs()
  const filename = `${entry.date}_${entry.time_id}_${entry.author}.json`
  fs.writeFileSync(path.join(DIARY_DIR, filename), JSON.stringify(entry, null, 2), 'utf-8')
}

function findDiary(date: string, author: string, timeId?: string): DiaryEntry | null {
  ensureDirs()
  if (timeId) {
    const p = path.join(DIARY_DIR, `${date}_${timeId}_${author}.json`)
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')) } catch { return null }
  }
  const matches = fs.readdirSync(DIARY_DIR)
    .filter(f => f.startsWith(`${date}_`) && f.endsWith(`_${author}.json`))
    .sort()
    .reverse()
  if (matches.length === 0) return null
  return JSON.parse(fs.readFileSync(path.join(DIARY_DIR, matches[0]), 'utf-8'))
}

function isVisible(entry: DiaryEntry, viewer: string): boolean {
  if (entry.author === viewer) return true
  if (entry.visibility === 'public') return true
  if (entry.visibility === 'timed' && entry.reveal_at) {
    if (new Date().toISOString() >= entry.reveal_at) return true
  }
  return false
}

function redact(entry: DiaryEntry): any {
  return { ...entry, content: '🔒 这是一篇上锁的日记', locked: true }
}

export function readDiaries(viewer: string, opts: { keyword?: string; author_filter?: string; target_date?: string } = {}) {
  let entries = listAllDiaries()
  if (opts.target_date) entries = entries.filter(e => e.date === opts.target_date)
  if (opts.author_filter) entries = entries.filter(e => e.author === opts.author_filter)
  if (opts.keyword) {
    const kw = opts.keyword.toLowerCase()
    entries = entries.filter(e =>
      `${e.title} ${e.content} ${(e.tags || []).join(' ')}`.toLowerCase().includes(kw)
    )
  }
  return entries.map(e => isVisible(e, viewer) ? e : redact(e))
}

export function writeDiary(data: {
  date: string; author: string; title: string; content: string;
  visibility: string; reveal_at?: string; tags?: string; type?: string
}): DiaryEntry {
  const tagList = data.tags ? data.tags.split(/\s+/).filter(Boolean) : []
  const now = new Date()
  const timeId = now.toTimeString().slice(0, 5).replace(':', '')
  // Normalize by type: 信(letter) 永远公开、不上锁、不定时; 时间胶囊(capsule) 定时; 普通日记(diary) 公开或上锁
  const type = data.type || (data.visibility === 'timed' ? 'capsule' : 'diary')
  let visibility = data.visibility
  if (type === 'letter') visibility = 'public'
  else if (type === 'capsule') visibility = 'timed'
  const entry: DiaryEntry = {
    date: data.date, author: data.author, title: data.title,
    content: data.content, type, visibility,
    reveal_at: visibility === 'timed' ? (data.reveal_at || null) : null,
    tags: tagList, comments: [], time_id: timeId,
    created_at: now.toISOString(), updated_at: null,
  }
  saveDiary(entry)
  return entry
}

export function commentDiary(targetDate: string, targetAuthor: string, commenter: string, content: string, timeId?: string): string {
  const entry = findDiary(targetDate, targetAuthor, timeId)
  if (!entry) return 'not_found'
  if (!isVisible(entry, commenter)) return 'locked'
  if (!entry.comments) entry.comments = []
  entry.comments.push({ author: commenter, content, time: new Date().toISOString() })
  saveDiary(entry)
  return 'ok'
}

export function updateDiary(targetDate: string, author: string, newContent: string, timeId?: string): string {
  const entry = findDiary(targetDate, author, timeId)
  if (!entry) return 'not_found'
  entry.content += `\n\n${newContent}`
  entry.updated_at = new Date().toISOString()
  saveDiary(entry)
  return 'ok'
}

export function deleteDiary(targetDate: string, author: string, timeId?: string): string {
  ensureDirs()
  let filename: string | null = null
  if (timeId) {
    filename = `${targetDate}_${timeId}_${author}.json`
  } else {
    const matches = fs.readdirSync(DIARY_DIR)
      .filter(f => f.startsWith(`${targetDate}_`) && f.endsWith(`_${author}.json`))
      .sort().reverse()
    if (matches.length > 0) filename = matches[0]
  }
  if (!filename) return 'not_found'
  const p = path.join(DIARY_DIR, filename)
  if (!fs.existsSync(p)) return 'not_found'
  fs.unlinkSync(p)
  return 'ok'
}

export function unlockDiary(targetAuthor: string, password: string, targetDate?: string, timeId?: string) {
  if (!checkPassword(targetAuthor, password)) return { error: '密码错误' }
  let entries = listAllDiaries().filter(e => e.author === targetAuthor && e.visibility === 'private')
  if (targetDate) entries = entries.filter(e => e.date === targetDate)
  if (timeId) entries = entries.filter(e => e.time_id === timeId)
  return { entries }
}

// ── Notes ───────────────────────────────────────────────

export interface NoteEntry {
  id: string
  author: string
  content: string
  tags: string[]
  replies: { author: string; content: string; time: string }[]
  created_at: string
}

export function listNotes(opts: { keyword?: string; limit?: number } = {}): NoteEntry[] {
  ensureDirs()
  let notes: NoteEntry[] = []
  for (const file of fs.readdirSync(NOTES_DIR).filter(f => f.endsWith('.json'))) {
    try {
      notes.push(JSON.parse(fs.readFileSync(path.join(NOTES_DIR, file), 'utf-8')))
    } catch {}
  }
  notes.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  if (opts.keyword) {
    const kw = opts.keyword.toLowerCase()
    notes = notes.filter(n =>
      `${n.content} ${(n.tags || []).join(' ')}`.toLowerCase().includes(kw)
    )
  }
  return notes.slice(0, opts.limit || 50)
}

export function writeNote(author: string, content: string, tags?: string): NoteEntry {
  ensureDirs()
  const now = new Date()
  const id = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14) + '_' + Math.random().toString(16).slice(2, 6)
  const tagList = tags ? tags.split(/\s+/).filter(Boolean) : []
  const note: NoteEntry = { id, author, content, tags: tagList, replies: [], created_at: now.toISOString() }
  fs.writeFileSync(path.join(NOTES_DIR, `${id}.json`), JSON.stringify(note, null, 2), 'utf-8')
  return note
}

export function replyNote(noteId: string, author: string, content: string): string {
  ensureDirs()
  const p = path.join(NOTES_DIR, `${noteId}.json`)
  if (!fs.existsSync(p)) return 'not_found'
  const note: NoteEntry = JSON.parse(fs.readFileSync(p, 'utf-8'))
  if (!note.replies) note.replies = []
  note.replies.push({ author, content, time: new Date().toISOString() })
  fs.writeFileSync(p, JSON.stringify(note, null, 2), 'utf-8')
  return 'ok'
}

export function deleteNote(noteId: string, author: string): string {
  ensureDirs()
  const p = path.join(NOTES_DIR, `${noteId}.json`)
  if (!fs.existsSync(p)) return 'not_found'
  const note: NoteEntry = JSON.parse(fs.readFileSync(p, 'utf-8'))
  if (note.author !== author) return 'forbidden'
  fs.unlinkSync(p)
  return 'ok'
}
