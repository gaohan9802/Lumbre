import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-pencil-case-'))
process.env.DATA_DIR = root
process.env.LUMBRE_PENCIL_WORKER_URL = 'http://pencil.test:8790'
process.env.LUMBRE_PENCIL_WORKER_SECRET = 'pencil-worker-fixture-secret-000000000'

let pencil: typeof import('../../src/server/pencil-case')
let drawings: typeof import('../../src/server/data/repositories/pencil-drawings')
let toolDisplayInput: typeof import('../../src/features/chat/tool-display').toolDisplayInput
let fetchCalls = 0
let workerPayload: any
const originalFetch = global.fetch
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

before(async () => {
  pencil = await import('../../src/server/pencil-case')
  drawings = await import('../../src/server/data/repositories/pencil-drawings')
  ;({ toolDisplayInput } = await import('../../src/features/chat/tool-display'))
  global.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    fetchCalls++
    workerPayload = JSON.parse(String(init?.body || '{}'))
    return Response.json({ mime: 'image/png', width: 1, height: 1, image_base64: png })
  }) as typeof fetch
})

after(() => {
  global.fetch = originalFetch
  rmSync(root, { recursive: true, force: true })
})

const input = {
  style: 'crayon',
  title: '回家',
  note: '今天也一起走',
  operation_key: 'fixture-drawing-1',
  scene_json: JSON.stringify({ elements: [
    { kind: 'blob', x: 200, y: 250, w: 300, h: 260, color: 'orange' },
    { kind: 'path', points: [[120, 700], [520, 620], [800, 730]], color: 'red' },
  ] }),
}

test('drawing tool sends only a declarative scene and safely reuses an operation key', async () => {
  const first = await pencil.drawPicture(input)
  const second = await pencil.drawPicture(input)
  assert.equal(fetchCalls, 1)
  assert.equal(first.already_drawn, false)
  assert.equal(second.already_drawn, true)
  assert.equal(first.drawing.id, second.drawing.id)
  assert.equal(workerPayload.style, 'crayon')
  assert.equal(Array.isArray(workerPayload.scene.elements), true)
  assert.equal('script' in workerPayload, false)
  assert.equal(existsSync(path.join(root, 'pencil-drawings', `${first.drawing.id}.png`)), true)
})

test('drawing tool accepts the common type alias and sends kind to the renderer', async () => {
  await pencil.drawPicture({
    ...input,
    operation_key: 'fixture-type-alias',
    scene_json: JSON.stringify({ elements: [{ type: 'ellipse', x: 400, y: 300, w: 200, h: 180, color: 'blue' }] }),
  })
  assert.deepEqual(workerPayload.scene.elements[0], { kind: 'ellipse', x: 400, y: 300, w: 200, h: 180, color: 'blue' })
})

test('generated drawing can be saved to the photo wall exactly once', async () => {
  const rendered = await pencil.drawPicture(input)
  const first = drawings.savePencilDrawingToPhoto(rendered.drawing.id)
  const second = drawings.savePencilDrawingToPhoto(rendered.drawing.id)
  assert.equal(first.already_saved, false)
  assert.equal(second.already_saved, true)
  assert.equal(first.photo.id, second.photo.id)
  assert.equal(first.photo.author, 'star')
})

test('invalid or oversized scenes fail before the worker is called', async () => {
  const before = fetchCalls
  await assert.rejects(() => pencil.drawPicture({ ...input, operation_key: 'fixture-bad-1', scene_json: '{broken' }), /valid JSON/)
  await assert.rejects(() => pencil.drawPicture({ ...input, operation_key: 'fixture-bad-2', scene_json: JSON.stringify({ elements: [] }) }), /1 to 30/)
  assert.equal(fetchCalls, before)
})

test('drawing tool details hide the full scene payload', () => {
  assert.deepEqual(toolDisplayInput('draw_picture', {
    style: 'crayon',
    title: '小火',
    scene_json: JSON.stringify({ elements: [{ kind: 'ellipse' }, { kind: 'text' }] }),
  }), { style: 'crayon', title: '小火', elements: 2 })
})
