/** Data repository for photo metadata and the locked-zone password. */
import fs from 'node:fs'
import { getDataDir } from '../config'
import { DataCorruptionError, DataFileNotFoundError } from '../errors'
import { readJsonFile, removeJsonFile, updateJsonFile, writeJsonFile } from '../json-file'
import { assertIdentifier, resolveDataPath } from '../safe-path'

const PHOTO_ID = /^[A-Za-z0-9_-]{1,128}$/
const DATA_DIR = getDataDir()
const PHOTOS_DIR = resolveDataPath(DATA_DIR, 'photos')
const PASSWORD_FILE = resolveDataPath(DATA_DIR, 'photos-password.json')

export interface PhotoComment {
  author: string
  content: string
  time: string
}

export interface PhotoEntry {
  id: string
  author: string
  url: string
  caption: string
  locked?: boolean
  comments: PhotoComment[]
  created_at: string
  updated_at: string | null
  source?: string
}

function fileFor(id: string): string {
  return resolveDataPath(PHOTOS_DIR, `${assertIdentifier(id, PHOTO_ID, 'photo id')}.json`)
}

function isPhotoEntry(value: unknown): boolean {
  const photo = value as Partial<PhotoEntry> | null
  return !!photo && typeof photo === 'object'
    && typeof photo.id === 'string'
    && typeof photo.url === 'string'
}

function isMissingOrCorrupt(error: unknown): boolean {
  return error instanceof DataFileNotFoundError || error instanceof DataCorruptionError
}

export function listPhotos(opts: { limit?: number; locked?: boolean } = {}): PhotoEntry[] {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true })
  const photos: PhotoEntry[] = []
  for (const file of fs.readdirSync(PHOTOS_DIR).filter(name => name.endsWith('.json'))) {
    try {
      photos.push(readJsonFile(resolveDataPath(PHOTOS_DIR, file), { validate: isPhotoEntry }))
    } catch {}
  }
  photos.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  const filtered = typeof opts.locked === 'boolean'
    ? photos.filter(photo => opts.locked ? !!photo.locked : !photo.locked)
    : photos
  return opts.limit ? filtered.slice(0, opts.limit) : filtered
}

export function getPhoto(id: string): PhotoEntry | null {
  const file = fileFor(id)
  try {
    return readJsonFile(file, { validate: isPhotoEntry })
  } catch (error) {
    if (isMissingOrCorrupt(error)) return null
    throw error
  }
}

export function writePhoto(data: { author: string; url: string; caption?: string; source?: string; locked?: boolean }): PhotoEntry {
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
  writeJsonFile(fileFor(id), photo)
  return photo
}

function updatePhoto(id: string, update: (photo: PhotoEntry) => void): string {
  const file = fileFor(id)
  try {
    updateJsonFile<PhotoEntry>(file, { validate: isPhotoEntry }, photo => {
      update(photo)
      return photo
    })
    return 'ok'
  } catch (error) {
    if (isMissingOrCorrupt(error)) return 'not_found'
    throw error
  }
}

export function editPhoto(id: string, patch: { caption?: string; locked?: boolean }): string {
  return updatePhoto(id, photo => {
    if (typeof patch.caption === 'string') photo.caption = patch.caption
    if (typeof patch.locked === 'boolean') photo.locked = patch.locked
    photo.updated_at = new Date().toISOString()
  })
}

export function deletePhoto(id: string): string {
  return removeJsonFile(fileFor(id)) ? 'ok' : 'not_found'
}

export function commentPhoto(id: string, author: string, content: string): string {
  return updatePhoto(id, photo => {
    if (!photo.comments) photo.comments = []
    photo.comments.push({ author, content, time: new Date().toISOString() })
  })
}

export function setPhotoPassword(password: string): void {
  writeJsonFile(PASSWORD_FILE, { password })
}

export function verifyPhotoPassword(password: string): boolean {
  try {
    const data = readJsonFile<{ password: string }>(PASSWORD_FILE, {
      validate: value => typeof (value as any)?.password === 'string',
    })
    return data.password === password
  } catch (error) {
    if (isMissingOrCorrupt(error)) return false
    throw error
  }
}

export function hasPhotoPassword(): boolean {
  try {
    return !!readJsonFile<{ password: string }>(PASSWORD_FILE, {
      validate: value => typeof (value as any)?.password === 'string',
    }).password
  } catch (error) {
    if (isMissingOrCorrupt(error)) return false
    throw error
  }
}
