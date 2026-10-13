/** Data repository for photo metadata, albums, image files and the locked-zone password. */
import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from '../config'
import { DataCorruptionError, DataFileNotFoundError } from '../errors'
import { readJsonFile, removeJsonFile, updateJsonFile, writeJsonFile } from '../json-file'
import { assertIdentifier, resolveDataPath } from '../safe-path'

const PHOTO_ID = /^[A-Za-z0-9_-]{1,128}$/
const ALBUM_ID = /^[A-Za-z0-9_-]{1,128}$/
const DATA_DIR = getDataDir()
const PHOTOS_DIR = resolveDataPath(DATA_DIR, 'photos')
const ASSETS_DIR = resolveDataPath(PHOTOS_DIR, 'assets')
const THUMBS_DIR = resolveDataPath(PHOTOS_DIR, 'thumbs')
const ALBUMS_FILE = resolveDataPath(DATA_DIR, 'photo-albums.json')
const PASSWORD_FILE = resolveDataPath(DATA_DIR, 'photos-password.json')

export type PhotoZone = 'wall' | 'travel' | 'locked'

export interface PhotoComment { author: string; content: string; time: string }
export interface PhotoAsset { file: string; mime: string }
export interface PhotoEntry {
  id: string
  author: string
  url: string
  caption: string
  zone?: PhotoZone
  album_id?: string
  locked?: boolean
  asset?: PhotoAsset
  comments: PhotoComment[]
  created_at: string
  updated_at: string | null
  source?: string
}
export interface PhotoAlbum {
  id: string
  name: string
  zone: PhotoZone
  built_in?: boolean
  created_at: string
  updated_at: string | null
}

const DEFAULT_ALBUMS: PhotoAlbum[] = [
  { id: 'wall-daily', name: '日常', zone: 'wall', built_in: true, created_at: '2026-01-01T00:00:00.000Z', updated_at: null },
  { id: 'wall-screenshots', name: '截图', zone: 'wall', built_in: true, created_at: '2026-01-01T00:00:00.000Z', updated_at: null },
  { id: 'travel-unsorted', name: '旅行碎片', zone: 'travel', built_in: true, created_at: '2026-01-01T00:00:00.000Z', updated_at: null },
  { id: 'locked-private', name: '私藏', zone: 'locked', built_in: true, created_at: '2026-01-01T00:00:00.000Z', updated_at: null },
]

function fileFor(id: string): string {
  return resolveDataPath(PHOTOS_DIR, `${assertIdentifier(id, PHOTO_ID, 'photo id')}.json`)
}
function assetPath(file: string): string {
  return resolveDataPath(ASSETS_DIR, assertIdentifier(file, /^[A-Za-z0-9_.-]{1,180}$/, 'photo asset'))
}
function thumbPath(id: string): string {
  return resolveDataPath(THUMBS_DIR, `${assertIdentifier(id, PHOTO_ID, 'photo id')}.webp`)
}
function isPhotoEntry(value: unknown): boolean {
  const photo = value as Partial<PhotoEntry> | null
  return !!photo && typeof photo === 'object' && typeof photo.id === 'string' && typeof photo.url === 'string'
}
function isAlbumList(value: unknown): boolean {
  return Array.isArray(value) && value.every(album => {
    const item = album as Partial<PhotoAlbum> | null
    return !!item && typeof item.id === 'string' && typeof item.name === 'string'
      && ['wall', 'travel', 'locked'].includes(String(item.zone))
  })
}
function isMissingOrCorrupt(error: unknown): boolean {
  return error instanceof DataFileNotFoundError || error instanceof DataCorruptionError
}
function zoneFor(photo: PhotoEntry): PhotoZone {
  if (photo.zone && ['wall', 'travel', 'locked'].includes(photo.zone)) return photo.zone
  return photo.locked ? 'locked' : 'wall'
}
function defaultAlbum(zone: PhotoZone): PhotoAlbum {
  return DEFAULT_ALBUMS.find(album => album.zone === zone)!
}
function mergePhotoAlbums(stored: PhotoAlbum[]): PhotoAlbum[] {
  return Array.from(new Map([...DEFAULT_ALBUMS, ...stored].map(album => [album.id, album])).values())
}
function normalizePhoto(photo: PhotoEntry): PhotoEntry {
  const zone = zoneFor(photo)
  return { ...photo, zone, album_id: photo.album_id || defaultAlbum(zone).id, locked: zone === 'locked', comments: Array.isArray(photo.comments) ? photo.comments : [] }
}
function parseDataUrl(url: string): { mime: string; bytes: Buffer } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(url)
  return match ? { mime: match[1].toLowerCase(), bytes: Buffer.from(match[2].replace(/\s/g, ''), 'base64') } : null
}
function extensionFor(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'image/avif') return 'avif'
  return 'jpg'
}
function writeBytesAtomic(file: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (fs.existsSync(file)) return
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx' })
    fs.renameSync(temporary, file)
  } finally {
    try { fs.unlinkSync(temporary) } catch {}
  }
}

/** Extract a legacy base64 image before shrinking its JSON metadata file. */
function migrateLegacyImage(photo: PhotoEntry): PhotoEntry {
  if (photo.asset || !photo.url.startsWith('data:')) return normalizePhoto(photo)
  const parsed = parseDataUrl(photo.url)
  if (!parsed?.bytes.length) return normalizePhoto(photo)
  const file = `${photo.id}.${extensionFor(parsed.mime)}`
  writeBytesAtomic(assetPath(file), parsed.bytes)
  const migrated = normalizePhoto({ ...photo, url: `/api/photos/raw/${photo.id}`, asset: { file, mime: parsed.mime } })
  // writeJsonFile retains the exact legacy record as .bak before this replacement.
  writeJsonFile(fileFor(photo.id), migrated)
  return migrated
}
function readPhoto(id: string): PhotoEntry {
  return migrateLegacyImage(readJsonFile(fileFor(id), { validate: isPhotoEntry }))
}

export function listPhotoAlbums(zone?: PhotoZone): PhotoAlbum[] {
  const stored = readJsonFile<PhotoAlbum[]>(ALBUMS_FILE, { fallback: () => [], validate: isAlbumList })
  const albums = mergePhotoAlbums(stored)
  return (zone ? albums.filter(album => album.zone === zone) : albums).sort((a, b) => a.created_at.localeCompare(b.created_at))
}
export function getPhotoAlbum(id: string): PhotoAlbum | null {
  assertIdentifier(id, ALBUM_ID, 'photo album id')
  return listPhotoAlbums().find(album => album.id === id) || null
}
export function createPhotoAlbum(name: string, zone: PhotoZone): PhotoAlbum {
  const clean = name.trim()
  if (!clean || clean.length > 30) throw new Error('album name must be 1-30 characters')
  if (!['wall', 'travel', 'locked'].includes(zone)) throw new Error('invalid photo zone')
  const now = new Date().toISOString()
  const album: PhotoAlbum = { id: `${zone}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, name: clean, zone, created_at: now, updated_at: null }
  updateJsonFile<PhotoAlbum[]>(ALBUMS_FILE, { fallback: () => [], validate: isAlbumList }, albums => {
    if (mergePhotoAlbums(albums).some(item => item.zone === zone && item.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new Error('album already exists')
    return [...albums, album]
  })
  return album
}
export function renamePhotoAlbum(id: string, name: string): PhotoAlbum | null {
  assertIdentifier(id, ALBUM_ID, 'photo album id')
  const clean = name.trim()
  if (!clean || clean.length > 30) throw new Error('album name must be 1-30 characters')
  let updated: PhotoAlbum | null = null
  updateJsonFile<PhotoAlbum[]>(ALBUMS_FILE, { fallback: () => [], validate: isAlbumList }, albums => {
    const effective = mergePhotoAlbums(albums)
    const current = effective.find(album => album.id === id)
    if (!current) return albums
    if (effective.some(item => item.id !== id && item.zone === current.zone && item.name.toLocaleLowerCase() === clean.toLocaleLowerCase())) throw new Error('album already exists')
    const replacement = { ...current, name: clean, updated_at: new Date().toISOString() }
    updated = replacement
    return albums.some(album => album.id === id)
      ? albums.map(album => album.id === id ? replacement : album)
      : [...albums, replacement]
  })
  return updated
}
export function deletePhotoAlbum(id: string): 'ok' | 'not_found' | 'not_empty' | 'built_in' {
  assertIdentifier(id, ALBUM_ID, 'photo album id')
  if (DEFAULT_ALBUMS.some(album => album.id === id)) return 'built_in'
  if (listPhotos({ albumId: id, limit: 1 }).length) return 'not_empty'
  let found = false
  updateJsonFile<PhotoAlbum[]>(ALBUMS_FILE, { fallback: () => [], validate: isAlbumList }, albums => albums.filter(album => {
    if (album.id === id) found = true
    return album.id !== id
  }))
  return found ? 'ok' : 'not_found'
}

export function listPhotos(opts: { limit?: number; locked?: boolean; zone?: PhotoZone; albumId?: string; offset?: number; excludeLocked?: boolean } = {}): PhotoEntry[] {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true })
  const photos: PhotoEntry[] = []
  for (const file of fs.readdirSync(PHOTOS_DIR).filter(name => name.endsWith('.json'))) {
    try { photos.push(readPhoto(path.basename(file, '.json'))) } catch {}
  }
  photos.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
  let filtered = photos
  if (typeof opts.locked === 'boolean') filtered = filtered.filter(photo => opts.locked ? photo.zone === 'locked' : photo.zone !== 'locked')
  if (opts.excludeLocked) filtered = filtered.filter(photo => photo.zone !== 'locked')
  if (opts.zone) filtered = filtered.filter(photo => photo.zone === opts.zone)
  if (opts.albumId) filtered = filtered.filter(photo => photo.album_id === opts.albumId)
  const offset = Math.max(0, opts.offset || 0)
  return opts.limit ? filtered.slice(offset, offset + opts.limit) : filtered.slice(offset)
}
export function listPhotoPage(opts: { limit?: number; zone: PhotoZone; albumId?: string; cursor?: string }): { photos: PhotoEntry[]; next_cursor: string | null } {
  const limit = Math.min(60, Math.max(1, opts.limit || 24))
  const offset = /^\d+$/.test(opts.cursor || '') ? Number(opts.cursor) : 0
  const rows = listPhotos({ zone: opts.zone, albumId: opts.albumId, offset, limit: limit + 1 })
  return { photos: rows.slice(0, limit), next_cursor: rows.length > limit ? String(offset + limit) : null }
}
export function getPhoto(id: string): PhotoEntry | null {
  try { return readPhoto(id) } catch (error) {
    if (isMissingOrCorrupt(error)) return null
    throw error
  }
}
function resolveAlbum(albumId: string | undefined, requestedZone: PhotoZone): PhotoAlbum {
  if (!albumId) return defaultAlbum(requestedZone)
  const album = getPhotoAlbum(albumId)
  if (!album) throw new Error('photo album not found')
  return album
}
export function writePhoto(data: { author: string; url: string; caption?: string; source?: string; locked?: boolean; zone?: PhotoZone; albumId?: string }): PhotoEntry {
  const now = new Date()
  const id = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14) + '_' + Math.random().toString(16).slice(2, 6)
  const requestedZone: PhotoZone = data.zone || (data.locked ? 'locked' : 'wall')
  const album = resolveAlbum(data.albumId, requestedZone)
  const parsed = parseDataUrl(data.url)
  let asset: PhotoAsset | undefined
  let url = data.url
  if (parsed?.bytes.length) {
    const file = `${id}.${extensionFor(parsed.mime)}`
    writeBytesAtomic(assetPath(file), parsed.bytes)
    asset = { file, mime: parsed.mime }
    url = `/api/photos/raw/${id}`
  } else if (!/^https?:\/\//i.test(url) && !/^\/api\/photos\/raw\//.test(url)) {
    throw new Error('photo url must be an image data URL or http(s) URL')
  }
  const photo: PhotoEntry = {
    id, author: data.author, url, caption: data.caption || '', zone: album.zone, album_id: album.id,
    locked: album.zone === 'locked', asset, comments: [], created_at: now.toISOString(), updated_at: null, source: data.source,
  }
  try { writeJsonFile(fileFor(id), photo) } catch (error) {
    if (asset) try { fs.unlinkSync(assetPath(asset.file)) } catch {}
    throw error
  }
  return photo
}
export function findPhotoBySource(source: string): PhotoEntry | null {
  return listPhotos().find(photo => photo.source === source) || null
}
function updatePhoto(id: string, update: (photo: PhotoEntry) => void): string {
  const file = fileFor(id)
  try {
    updateJsonFile<PhotoEntry>(file, { validate: isPhotoEntry }, current => {
      const photo = normalizePhoto(current)
      update(photo)
      return photo
    })
    return 'ok'
  } catch (error) {
    if (isMissingOrCorrupt(error)) return 'not_found'
    throw error
  }
}
export function editPhoto(id: string, patch: { caption?: string; locked?: boolean; albumId?: string }): string {
  return updatePhoto(id, photo => {
    if (typeof patch.caption === 'string') photo.caption = patch.caption
    if (patch.albumId) {
      const album = getPhotoAlbum(patch.albumId)
      if (!album) throw new Error('photo album not found')
      photo.album_id = album.id
      photo.zone = album.zone
      photo.locked = album.zone === 'locked'
    } else if (typeof patch.locked === 'boolean') {
      const zone: PhotoZone = patch.locked ? 'locked' : 'wall'
      photo.zone = zone
      photo.album_id = defaultAlbum(zone).id
      photo.locked = patch.locked
    }
    photo.updated_at = new Date().toISOString()
  })
}
export function deletePhoto(id: string): string {
  const photo = getPhoto(id)
  if (!removeJsonFile(fileFor(id))) return 'not_found'
  if (photo?.asset) try { fs.unlinkSync(assetPath(photo.asset.file)) } catch {}
  try { fs.unlinkSync(thumbPath(id)) } catch {}
  return 'ok'
}
export function commentPhoto(id: string, author: string, content: string): string {
  return updatePhoto(id, photo => {
    photo.comments.push({ author, content, time: new Date().toISOString() })
    photo.updated_at = new Date().toISOString()
  })
}
export function photoImageDataUrl(photo: PhotoEntry): string {
  if (photo.asset) return `data:${photo.asset.mime};base64,${fs.readFileSync(assetPath(photo.asset.file)).toString('base64')}`
  return photo.url
}
export async function photoThumbnail(id: string): Promise<{ bytes?: Buffer; mime?: string; redirect?: string } | null> {
  const photo = getPhoto(id)
  if (!photo) return null
  const local = parseDataUrl(photo.url)
  const source = photo.asset ? fs.readFileSync(assetPath(photo.asset.file)) : local?.bytes
  if (!source) return /^https?:\/\//i.test(photo.url) ? { redirect: photo.url } : null
  const file = thumbPath(id)
  if (!fs.existsSync(file)) {
    const sharp = (await import('sharp')).default
    const bytes = await sharp(source).rotate().resize(640, 640, { fit: 'cover', withoutEnlargement: true }).webp({ quality: 76 }).toBuffer()
    writeBytesAtomic(file, bytes)
  }
  return { bytes: fs.readFileSync(file), mime: 'image/webp' }
}

export function setPhotoPassword(password: string): void { writeJsonFile(PASSWORD_FILE, { password }) }
export function verifyPhotoPassword(password: string): boolean {
  try { return readJsonFile<{ password: string }>(PASSWORD_FILE, { validate: value => typeof (value as any)?.password === 'string' }).password === password }
  catch (error) { if (isMissingOrCorrupt(error)) return false; throw error }
}
export function hasPhotoPassword(): boolean {
  try { return !!readJsonFile<{ password: string }>(PASSWORD_FILE, { validate: value => typeof (value as any)?.password === 'string' }).password }
  catch (error) { if (isMissingOrCorrupt(error)) return false; throw error }
}
