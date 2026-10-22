import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getDataDir } from '../config'
import { resolveDataPath } from '../safe-path'

const DATA_DIR = getDataDir()
const ASSETS_DIR = resolveDataPath(DATA_DIR, 'chat', 'assets')
const ASSET_REF = /^\/api\/chat-assets\/([a-f0-9]{64}\.(?:jpg|png|webp|gif|avif))$/
const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
])
const EXTENSION_MIME = new Map(Array.from(MIME_EXTENSIONS, ([mime, extension]) => [extension, mime]))

function parseImageDataUrl(value: string): { mime: string; bytes: Buffer } | null {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\r\n]+)$/i.exec(value)
  if (!match) return null
  const mime = match[1].toLowerCase()
  if (!MIME_EXTENSIONS.has(mime)) return null
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64')
  return bytes.length ? { mime, bytes } : null
}

function assetPath(file: string): string {
  return resolveDataPath(ASSETS_DIR, file)
}

/** Move an inline chat image out of the session JSON without changing its bytes. */
export function storeChatImage(value: string): string {
  const parsed = parseImageDataUrl(value)
  if (!parsed) return value
  const extension = MIME_EXTENSIONS.get(parsed.mime)!
  const file = `${createHash('sha256').update(parsed.bytes).digest('hex')}.${extension}`
  const target = assetPath(file)
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`
    try {
      fs.writeFileSync(temporary, parsed.bytes, { flag: 'wx' })
      fs.renameSync(temporary, target)
    } finally {
      try { fs.unlinkSync(temporary) } catch {}
    }
  }
  return `/api/chat-assets/${file}`
}

export function readChatImage(reference: string): { mime: string; bytes: Buffer } | null {
  const match = ASSET_REF.exec(reference)
  if (!match) return null
  try {
    const extension = match[1].split('.').pop()!
    return { mime: EXTENSION_MIME.get(extension)!, bytes: fs.readFileSync(assetPath(match[1])) }
  } catch {
    return null
  }
}

export function chatImageDataUrl(reference: string): string | null {
  const image = readChatImage(reference)
  return image ? `data:${image.mime};base64,${image.bytes.toString('base64')}` : null
}
