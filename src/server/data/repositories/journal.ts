/** Central data repository for diaries, notes, and their existing shared config. */
import fs from 'node:fs'
import path from 'node:path'
import { formatMadrid, parseMadridDateTime } from '@/lib/madrid-time'
import { getDataDir } from '../config'
import { DataCorruptionError, DataFileNotFoundError } from '../errors'
import { readJsonFile, removeJsonFile, removeJsonFileIf, updateJsonFile, writeJsonFile } from '../json-file'
import { withFileLock } from '../lock'
import { assertDateKey, assertIdentifier, resolveDataPath } from '../safe-path'

const ACTOR = /^(?:star|fire)$/
const TIME_ID = /^\d{4}$/
const NOTE_ID = /^[A-Za-z0-9_-]{1,128}$/
const DATA_DIR = getDataDir()
const DIARY_DIR = resolveDataPath(DATA_DIR, 'diaries')
const NOTES_DIR = resolveDataPath(DATA_DIR, 'notes')
const CONFIG_FILE = resolveDataPath(DATA_DIR, 'config.json')
const SEED_LOCK = resolveDataPath(DATA_DIR, '.journal-seed')

function actor(value: string): string {
  return assertIdentifier(value, ACTOR, 'author')
}

function timeId(value: string): string {
  return assertIdentifier(value, TIME_ID, 'diary time id')
}

function noteId(value: string): string {
  return assertIdentifier(value, NOTE_ID, 'note id')
}

function ensureDirs(): void {
  fs.mkdirSync(DIARY_DIR, { recursive: true })
  fs.mkdirSync(NOTES_DIR, { recursive: true })
}

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

export interface NoteEntry {
  id: string
  author: string
  content: string
  tags: string[]
  replies: { author: string; content: string; time: string }[]
  created_at: string
}

function isDiaryEntry(value: unknown): boolean {
  const entry = value as Partial<DiaryEntry> | null
  return !!entry && typeof entry === 'object'
    && typeof entry.date === 'string'
    && typeof entry.author === 'string'
    && typeof entry.content === 'string'
    && typeof entry.time_id === 'string'
}

function isNoteEntry(value: unknown): boolean {
  const entry = value as Partial<NoteEntry> | null
  return !!entry && typeof entry === 'object'
    && typeof entry.id === 'string'
    && typeof entry.author === 'string'
    && typeof entry.content === 'string'
}

function diaryFile(entry: Pick<DiaryEntry, 'date' | 'time_id' | 'author'>): string {
  const filename = `${assertDateKey(entry.date)}_${timeId(entry.time_id)}_${actor(entry.author)}.json`
  return resolveDataPath(DIARY_DIR, filename)
}

function noteFile(id: string): string {
  return resolveDataPath(NOTES_DIR, `${noteId(id)}.json`)
}

function findSeedFile(name: 'diaries.json' | 'notes.json'): string | null {
  const candidates = [
    resolveDataPath(DATA_DIR, name),
    path.join(process.cwd(), 'src', 'seed', name),
    path.join(__dirname, '..', '..', '..', 'seed', name),
  ]
  return candidates.find(candidate => fs.existsSync(candidate)) || null
}

function migrateIfNeeded(): void {
  ensureDirs()
  withFileLock(SEED_LOCK, () => {
    if (fs.readdirSync(DIARY_DIR).filter(file => file.endsWith('.json')).length === 0) {
      const seedPath = findSeedFile('diaries.json')
      if (seedPath) {
        try {
          const entries = readJsonFile<unknown[]>(seedPath, { validate: Array.isArray })
          let written = 0
          for (const value of entries) {
            if (!isDiaryEntry(value)) continue
            try { writeJsonFile(diaryFile(value as DiaryEntry), value); written += 1 } catch {}
          }
          console.log(`[journal-repository] Seeded ${written} diaries from ${seedPath}`)
        } catch (error) {
          console.error('[journal-repository] Failed to seed diaries:', error)
        }
      }
    }

    if (fs.readdirSync(NOTES_DIR).filter(file => file.endsWith('.json')).length === 0) {
      const seedPath = findSeedFile('notes.json')
      if (seedPath) {
        try {
          const notes = readJsonFile<unknown[]>(seedPath, { validate: Array.isArray })
          let written = 0
          for (const value of notes) {
            if (!isNoteEntry(value)) continue
            try { writeJsonFile(noteFile((value as NoteEntry).id), value); written += 1 } catch {}
          }
          console.log(`[journal-repository] Seeded ${written} notes from ${seedPath}`)
        } catch (error) {
          console.error('[journal-repository] Failed to seed notes:', error)
        }
      }
    }
  })
}

migrateIfNeeded()

function isMissingOrCorrupt(error: unknown): boolean {
  return error instanceof DataFileNotFoundError || error instanceof DataCorruptionError
}

function loadConfig(): Record<string, any> {
  return readJsonFile(CONFIG_FILE, {
    fallback: () => ({ passwords: {} }),
    fallbackOnInvalid: true,
    validate: value => !!value && typeof value === 'object' && !Array.isArray(value),
  })
}

export function setPassword(author: string, password: string): void {
  const validAuthor = actor(author)
  updateJsonFile<Record<string, any>>(
    CONFIG_FILE,
    {
      fallback: () => ({ passwords: {} }),
      fallbackOnInvalid: true,
      validate: value => !!value && typeof value === 'object' && !Array.isArray(value),
    },
    config => {
      const passwords = config.passwords && typeof config.passwords === 'object' && !Array.isArray(config.passwords)
        ? config.passwords
        : {}
      return { ...config, passwords: { ...passwords, [validAuthor]: password } }
    },
  )
}

export function checkPassword(author: string, password: string): boolean {
  const correct = loadConfig().passwords?.[actor(author)]
  return !!correct && password === correct
}

export function hasPassword(author: string): boolean {
  return !!loadConfig().passwords?.[actor(author)]
}

function listAllDiaries(): DiaryEntry[] {
  ensureDirs()
  const entries: DiaryEntry[] = []
  for (const file of fs.readdirSync(DIARY_DIR).filter(name => name.endsWith('.json'))) {
    try {
      entries.push(readJsonFile(resolveDataPath(DIARY_DIR, file), { validate: isDiaryEntry }))
    } catch {}
  }
  return entries.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
}

function findDiaryFile(date: string, authorValue: string, optionalTimeId?: string): string | null {
  const validDate = assertDateKey(date)
  const validAuthor = actor(authorValue)
  ensureDirs()
  if (optionalTimeId) return resolveDataPath(DIARY_DIR, `${validDate}_${timeId(optionalTimeId)}_${validAuthor}.json`)
  const matches = fs.readdirSync(DIARY_DIR)
    .filter(file => file.startsWith(`${validDate}_`) && file.endsWith(`_${validAuthor}.json`))
    .sort()
    .reverse()
  return matches[0] ? resolveDataPath(DIARY_DIR, matches[0]) : null
}

function readDiary(file: string | null): DiaryEntry | null {
  if (!file) return null
  try { return readJsonFile(file, { validate: isDiaryEntry }) } catch (error) {
    if (isMissingOrCorrupt(error)) return null
    throw error
  }
}

function isVisible(entry: DiaryEntry, viewer: string): boolean {
  if (entry.author === viewer || entry.visibility === 'public') return true
  if (entry.visibility === 'timed' && entry.reveal_at) {
    const reveal = parseMadridDateTime(entry.reveal_at)
    return !!reveal && Date.now() >= reveal.getTime()
  }
  return false
}

function redact(entry: DiaryEntry): any {
  return { ...entry, content: '🔒 这是一篇上锁的日记', locked: true }
}

export function readDiaries(
  viewer: string,
  opts: { keyword?: string; author_filter?: string; target_date?: string } = {},
): any[] {
  let entries = listAllDiaries()
  if (opts.target_date) {
    const date = assertDateKey(opts.target_date)
    entries = entries.filter(entry => entry.date === date)
  }
  if (opts.author_filter) {
    const filter = actor(opts.author_filter)
    entries = entries.filter(entry => entry.author === filter)
  }
  if (opts.keyword) {
    const keyword = opts.keyword.toLowerCase()
    entries = entries.filter(entry => `${entry.title} ${entry.content} ${(entry.tags || []).join(' ')}`.toLowerCase().includes(keyword))
  }
  return entries.map(entry => isVisible(entry, viewer) ? entry : redact(entry))
}

export function writeDiary(data: {
  date: string
  author: string
  title: string
  content: string
  visibility: string
  reveal_at?: string
  tags?: string
  type?: string
}): DiaryEntry {
  const now = new Date()
  const type = data.type || (data.visibility === 'timed' ? 'capsule' : 'diary')
  let visibility = data.visibility
  if (type === 'letter') visibility = 'public'
  else if (type === 'capsule') visibility = 'timed'
  const entry: DiaryEntry = {
    date: assertDateKey(data.date),
    author: actor(data.author),
    title: data.title,
    content: data.content,
    type,
    visibility,
    reveal_at: visibility === 'timed' ? (parseMadridDateTime(data.reveal_at)?.toISOString() || null) : null,
    tags: data.tags ? data.tags.split(/\s+/).filter(Boolean) : [],
    comments: [],
    time_id: formatMadrid(now, false).slice(-5).replace(':', ''),
    created_at: now.toISOString(),
    updated_at: null,
  }
  writeJsonFile(diaryFile(entry), entry)
  return entry
}

function updateDiaryFile(
  targetDate: string,
  targetAuthor: string,
  optionalTimeId: string | undefined,
  update: (entry: DiaryEntry) => string | undefined,
): string {
  const file = findDiaryFile(targetDate, targetAuthor, optionalTimeId)
  if (!file) return 'not_found'
  let result = 'not_found'
  try {
    updateJsonFile<DiaryEntry>(file, { validate: isDiaryEntry }, entry => {
      const outcome = update(entry)
      if (!outcome) return undefined
      result = outcome
      if (outcome === 'locked') return undefined
      return entry
    })
  } catch (error) {
    if (isMissingOrCorrupt(error)) return 'not_found'
    throw error
  }
  return result
}

export function commentDiary(targetDate: string, targetAuthor: string, commenter: string, content: string, optionalTimeId?: string): string {
  return updateDiaryFile(targetDate, targetAuthor, optionalTimeId, entry => {
    if (!isVisible(entry, commenter)) return 'locked'
    if (!entry.comments) entry.comments = []
    entry.comments.push({ author: commenter, content, time: new Date().toISOString() })
    return 'ok'
  })
}

export function updateDiary(targetDate: string, authorValue: string, newContent: string, optionalTimeId?: string): string {
  return updateDiaryFile(targetDate, authorValue, optionalTimeId, entry => {
    entry.content += `\n\n${newContent}`
    entry.updated_at = new Date().toISOString()
    return 'ok'
  })
}

export function deleteDiary(targetDate: string, authorValue: string, optionalTimeId?: string): string {
  const file = findDiaryFile(targetDate, authorValue, optionalTimeId)
  return file && removeJsonFile(file) ? 'ok' : 'not_found'
}

export function unlockDiary(targetAuthor: string, password: string, targetDate?: string, optionalTimeId?: string): { error?: string; entries?: DiaryEntry[] } {
  const validAuthor = actor(targetAuthor)
  if (!checkPassword(validAuthor, password)) return { error: '密码错误' }
  let entries = listAllDiaries().filter(entry => entry.author === validAuthor && entry.visibility === 'private')
  if (targetDate) {
    const date = assertDateKey(targetDate)
    entries = entries.filter(entry => entry.date === date)
  }
  if (optionalTimeId) {
    const id = timeId(optionalTimeId)
    entries = entries.filter(entry => entry.time_id === id)
  }
  return { entries }
}

export function listNotes(opts: { keyword?: string; limit?: number } = {}): NoteEntry[] {
  ensureDirs()
  const notes: NoteEntry[] = []
  for (const file of fs.readdirSync(NOTES_DIR).filter(name => name.endsWith('.json'))) {
    try { notes.push(readJsonFile(resolveDataPath(NOTES_DIR, file), { validate: isNoteEntry })) } catch {}
  }
  notes.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  const filtered = opts.keyword
    ? notes.filter(note => `${note.content} ${(note.tags || []).join(' ')}`.toLowerCase().includes(opts.keyword!.toLowerCase()))
    : notes
  return filtered.slice(0, opts.limit || 50)
}

export function writeNote(authorValue: string, content: string, tags?: string): NoteEntry {
  const now = new Date()
  const id = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14) + '_' + Math.random().toString(16).slice(2, 6)
  const note: NoteEntry = {
    id,
    author: actor(authorValue),
    content,
    tags: tags ? tags.split(/\s+/).filter(Boolean) : [],
    replies: [],
    created_at: now.toISOString(),
  }
  writeJsonFile(noteFile(id), note)
  return note
}

export function replyNote(id: string, authorValue: string, content: string): string {
  try {
    updateJsonFile<NoteEntry>(noteFile(id), { validate: isNoteEntry }, note => {
      if (!note.replies) note.replies = []
      note.replies.push({ author: authorValue, content, time: new Date().toISOString() })
      return note
    })
    return 'ok'
  } catch (error) {
    if (isMissingOrCorrupt(error)) return 'not_found'
    throw error
  }
}

export function deleteNote(id: string, authorValue: string): string {
  const file = noteFile(id)
  try {
    const result = removeJsonFileIf<NoteEntry>(file, { validate: isNoteEntry }, note => note.author === authorValue)
    if (result === 'removed') return 'ok'
    if (result === 'rejected') return 'forbidden'
    return 'not_found'
  } catch (error) {
    if (isMissingOrCorrupt(error)) return 'not_found'
    throw error
  }
}
