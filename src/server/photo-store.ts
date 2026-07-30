/**
 * Local file-based storage for photos.
 * Each photo is one JSON file in DATA_DIR/photos/ holding metadata + dataUrl.
 * Uploaded from chat (user) — both user and AI can edit/delete/comment.
 * Supports locked/public zones with password protection.
 */
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR || '/persistent'
const PHOTOS_DIR = path.join(DATA_DIR, 'photos')
const PASSWORD_FILE = path.join(DATA_DIR, 'photos-password.json')

function ensureDir() {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true })
}

export interface PhotoComment {
  author: string
  content: string
  time: string
}

export interface PhotoEntry {
  id: string
  author: string          // 'star' | 'fire'
  url: string             // data URL (base64) or remote URL
  caption: string
  locked?: boolean        // if true, in the locked zone
  comments: PhotoComment[]
  created_at: string
  updated_at: string | null
  source?: string         // e.g. 'chat'
}

function fileFor(id: string) {
  return path.join(PHOTOS_DIR, `${id}.json`)
}

export function listPhotos(opts: { limit?: number; locked?: boolean } = {}): PhotoEntry[] {
  ensureDir()
  const photos: PhotoEntry[] = []
  for (const f of fs.readdirSync(PHOTOS_DIR).filter((x) => x.endsWith('.json'))) {
    try {
      photos.push(JSON.parse(fs.readFileSync(path.join(PHOTOS_DIR, f), 'utf-8')))
    } catch {}
  }
  photos.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  // Filter by locked zone if specified
  let filtered = photos
  if (typeof opts.locked === 'boolean') {
    filtered = photos.filter(p => opts.locked ? !!p.locked : !p.locked)
  }
  return opts.limit ? filtered.slice(0, opts.limit) : filtered
}

export function getPhoto(id: string): PhotoEntry | null {
  ensureDir()
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), 'utf-8'))
  } catch {
    return null
  }
}

export function writePhoto(data: { author: string; url: string; caption?: string; source?: string; locked?: boolean }): PhotoEntry {
  ensureDir()
  const now = new Date()
  const id = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14) + '_' + Math.random().toString(16).slice(2, 6)
  const photo: PhotoEntry = {
    id,
    author: data.author,
    url: data.url,
    caption: data.caption || '',
    locked: data.locked || false,
    comments: [],
    created_at: now.toISOString(),
    updated_at: null,
    source: data.source,
  }
  fs.writeFileSync(fileFor(id), JSON.stringify(photo, null, 2), 'utf-8')
  return photo
}

export function editPhoto(id: string, patch: { caption?: string; locked?: boolean }): string {
  const photo = getPhoto(id)
  if (!photo) return 'not_found'
  if (typeof patch.caption === 'string') photo.caption = patch.caption
  if (typeof patch.locked === 'boolean') photo.locked = patch.locked
  photo.updated_at = new Date().toISOString()
  fs.writeFileSync(fileFor(id), JSON.stringify(photo, null, 2), 'utf-8')
  return 'ok'
}

export function deletePhoto(id: string): string {
  ensureDir()
  const p = fileFor(id)
  if (!fs.existsSync(p)) return 'not_found'
  fs.unlinkSync(p)
  return 'ok'
}

export function commentPhoto(id: string, author: string, content: string): string {
  const photo = getPhoto(id)
  if (!photo) return 'not_found'
  if (!photo.comments) photo.comments = []
  photo.comments.push({ author, content, time: new Date().toISOString() })
  fs.writeFileSync(fileFor(id), JSON.stringify(photo, null, 2), 'utf-8')
  return 'ok'
}

// Password management for locked zone
export function setPhotoPassword(password: string): void {
  fs.writeFileSync(PASSWORD_FILE, JSON.stringify({ password }), 'utf-8')
}

export function verifyPhotoPassword(password: string): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(PASSWORD_FILE, 'utf-8'))
    return data.password === password
  } catch {
    return false
  }
}

export function hasPhotoPassword(): boolean {
  try {
    const data = JSON.parse(fs.readFileSync(PASSWORD_FILE, 'utf-8'))
    return !!data.password
  } catch {
    return false
  }
}
