import { findPencilDrawingByOperation, writePencilDrawing } from './data/repositories/pencil-drawings'

type PencilStyle = 'crayon' | 'penwash'

export type DrawPictureInput = {
  style?: unknown
  title?: unknown
  note?: unknown
  operation_key?: unknown
  seed?: unknown
  scene_json?: unknown
}

function shortText(value: unknown, name: string, max: number, required = false): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (required && !text) throw new Error(`${name} is required`)
  if (text.length > max) throw new Error(`${name} is too long`)
  return text
}

function workerConfig() {
  const rawUrl = String(process.env.LUMBRE_PENCIL_WORKER_URL || '').trim()
  const secret = String(process.env.LUMBRE_PENCIL_WORKER_SECRET || '')
  if (!rawUrl || secret.length < 32) throw new Error('画室尚未配置')
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error('画室地址无效') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('画室地址无效')
  }
  return { url: `${url.toString().replace(/\/$/, '')}/render`, secret }
}

function parseScene(value: unknown): Record<string, unknown> {
  const text = shortText(value, 'scene_json', 48_000, true)
  let scene: unknown
  try { scene = JSON.parse(text) } catch { throw new Error('scene_json must be valid JSON') }
  if (!scene || typeof scene !== 'object' || Array.isArray(scene)) throw new Error('scene_json must contain an object')
  const elements = (scene as any).elements
  if (!Array.isArray(elements) || elements.length < 1 || elements.length > 30) {
    throw new Error('scene_json must contain 1 to 30 elements')
  }
  return scene as Record<string, unknown>
}

export async function drawPicture(input: DrawPictureInput) {
  const style = input.style
  if (style !== 'crayon' && style !== 'penwash') throw new Error('style must be crayon or penwash')
  const operationKey = shortText(input.operation_key, 'operation_key', 120, true)
  if (!/^[A-Za-z0-9._:-]{4,120}$/.test(operationKey)) throw new Error('operation_key contains unsupported characters')
  const existing = findPencilDrawingByOperation(operationKey)
  if (existing) return { drawing: existing, already_drawn: true, image_url: `/api/pencil-drawings/raw/${existing.id}` }

  const title = shortText(input.title, 'title', 40)
  const note = shortText(input.note, 'note', 60)
  const scene = parseScene(input.scene_json)
  const config = workerConfig()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45_000)
  timer.unref?.()
  let response: Response
  try {
    response = await fetch(config.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.secret}` },
      body: JSON.stringify({ style, title, note, seed: shortText(input.seed, 'seed', 120), scene }),
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch (error: any) {
    throw new Error(error?.name === 'AbortError' ? '画画超时了' : '画室暂时连不上')
  } finally {
    clearTimeout(timer)
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error === 'busy' ? '画室正在画上一张，请稍后再试' : String(body?.error || `画室返回 ${response.status}`))
  if (body?.mime !== 'image/png' || typeof body?.image_base64 !== 'string' || body.image_base64.length > 12_000_000) {
    throw new Error('画室返回了无效图片')
  }
  const bytes = Buffer.from(body.image_base64, 'base64')
  if (!bytes.length || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('画室返回了无效 PNG')
  const completedWhileRendering = findPencilDrawingByOperation(operationKey)
  if (completedWhileRendering) return { drawing: completedWhileRendering, already_drawn: true, image_url: `/api/pencil-drawings/raw/${completedWhileRendering.id}` }
  const drawing = writePencilDrawing({ style: style as PencilStyle, title, note, operation_key: operationKey }, bytes)
  return { drawing, already_drawn: false, image_url: `/api/pencil-drawings/raw/${drawing.id}` }
}

