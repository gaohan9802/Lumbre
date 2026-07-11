/**
 * Local file-based storage for photos.
 * Each photo is one JSON file in DATA_DIR/photos/ holding metadata + dataUrl.
 * Uploaded from chat (user) — both user and AI can edit/delete/comment.
 */
import fs from 'fs'
import path from 'path'

const DATA_DIR = process.env.DATA_DIR || '/persistent'
const PHOTOS_DIR = path.join(DATA_DIR, 'photos')

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
  comments: PhotoComment[]
  created_at: string
  updated_at: string | null
  source?: string         // e.g. 'chat'
}

function fileFor(id: string) {
  return path.join(PHOTOS_DIR, `${id}.json`)
}

export function listPhotos(opts: { limit?: number } = {}): PhotoEntry[] {
  ensureDir()
  const photos: PhotoEntry[] = []
  for (const f of fs.readdirSync(PHOTOS_DIR).filter((x) => x.endsWith('.json'))) {
    try {
      photos.push(JSON.parse(fs.readFileSync(path.join(PHOTOS_DIR, f), 'utf-8')))
    } catch {}
  }
  photos.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  return opts.limit ? photos.slice(0, opts.limit) : photos
}

export function getPhoto(id: string): PhotoEntry | null {
  ensureDir()
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), 'utf-8'))
  } catch {
    return null
  }
}

export function writePhoto(data: { author: string; url: string; caption?: string; source?: string }): PhotoEntry {
  ensureDir()
  const now = new Date()
  const id = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14) + '_' + Math.random().toString(16).slice(2, 6)
  const photo: PhotoEntry = {
    id,
    author: data.author,
    url: data.url,
    caption: data.caption || '',
    comments: [],
    created_at: now.toISOString(),
    updated_at: null,
    source: data.source,
  }
  fs.writeFileSync(fileFor(id), JSON.stringify(photo, null, 2), 'utf-8')
  return photo
}

export function editPhoto(id: string, patch: { caption?: string }): string {
  const photo = getPhoto(id)
  if (!photo) return 'not_found'
  if (typeof patch.caption === 'string') photo.caption = patch.caption
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
