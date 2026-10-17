import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from '../config'
import { readJsonFile, writeJsonFile } from '../json-file'
import { assertIdentifier, resolveDataPath } from '../safe-path'
import { findPhotoBySource, writePhoto } from './photos'

const DRAWING_ID = /^[A-Za-z0-9_-]{1,128}$/
const DATA_DIR = getDataDir()
const DRAWINGS_DIR = resolveDataPath(DATA_DIR, 'pencil-drawings')

export interface PencilDrawing {
  id: string
  style: 'crayon' | 'penwash'
  title: string
  note: string
  operation_key: string
  created_at: string
}

function metadataPath(id: string) {
  return resolveDataPath(DRAWINGS_DIR, `${assertIdentifier(id, DRAWING_ID, 'drawing id')}.json`)
}

function imagePath(id: string) {
  return resolveDataPath(DRAWINGS_DIR, `${assertIdentifier(id, DRAWING_ID, 'drawing id')}.png`)
}

function validDrawing(value: unknown): value is PencilDrawing {
  const drawing = value as Partial<PencilDrawing> | null
  return !!drawing && typeof drawing === 'object' && typeof drawing.id === 'string'
    && ['crayon', 'penwash'].includes(String(drawing.style))
    && typeof drawing.operation_key === 'string'
}

export function getPencilDrawing(id: string): PencilDrawing | null {
  try { return readJsonFile(metadataPath(id), { validate: validDrawing }) }
  catch { return null }
}

export function getPencilDrawingImage(id: string): Buffer | null {
  try {
    if (!getPencilDrawing(id)) return null
    return fs.readFileSync(imagePath(id))
  } catch { return null }
}

export function findPencilDrawingByOperation(operationKey: string): PencilDrawing | null {
  if (!operationKey || !fs.existsSync(DRAWINGS_DIR)) return null
  for (const file of fs.readdirSync(DRAWINGS_DIR)) {
    if (!file.endsWith('.json')) continue
    try {
      const drawing = readJsonFile<PencilDrawing>(resolveDataPath(DRAWINGS_DIR, file), { validate: validDrawing })
      if (drawing.operation_key === operationKey) return drawing
    } catch {}
  }
  return null
}

export function writePencilDrawing(input: Omit<PencilDrawing, 'id' | 'created_at'>, bytes: Buffer): PencilDrawing {
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('invalid drawing image')
  fs.mkdirSync(DRAWINGS_DIR, { recursive: true })
  const id = `drawing-${randomUUID()}`
  const drawing: PencilDrawing = { ...input, id, created_at: new Date().toISOString() }
  const temporary = `${imagePath(id)}.${process.pid}.tmp`
  try {
    fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 })
    fs.renameSync(temporary, imagePath(id))
    writeJsonFile(metadataPath(id), drawing)
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch {}
    try { fs.unlinkSync(imagePath(id)) } catch {}
    throw error
  }
  return drawing
}

export function savePencilDrawingToPhoto(id: string, albumId?: string) {
  const drawing = getPencilDrawing(id)
  const image = getPencilDrawingImage(id)
  if (!drawing || !image) throw new Error('drawing not found')
  const source = `pencil:${drawing.id}`
  const existing = findPhotoBySource(source)
  if (existing) return { photo: existing, already_saved: true }
  const photo = writePhoto({
    author: 'star',
    url: `data:image/png;base64,${image.toString('base64')}`,
    caption: drawing.note || drawing.title,
    source,
    albumId,
    zone: 'wall',
  })
  return { photo, already_saved: false }
}

