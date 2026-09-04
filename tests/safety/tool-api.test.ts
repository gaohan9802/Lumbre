import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-tool-api-'))
process.env.DATA_DIR = root
process.env.LUMBRE_AUTH_SECRET = 'stage-two-tool-api-secret-for-tests'

let NextRequest: typeof import('next/server').NextRequest
let executor: typeof import('../../src/server/agent/executor')
let contextModule: typeof import('../../src/server/agent/context')
let noteStore: typeof import('../../src/server/diary-store')
let confirmRoute: typeof import('../../src/app/api/tools/confirm/route')
let auditRoute: typeof import('../../src/app/api/tools/audit/route')

before(async () => {
  ;({ NextRequest } = await import('next/server'))
  executor = await import('../../src/server/agent/executor')
  contextModule = await import('../../src/server/agent/context')
  noteStore = await import('../../src/server/diary-store')
  confirmRoute = await import('../../src/app/api/tools/confirm/route')
  auditRoute = await import('../../src/app/api/tools/audit/route')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('confirmation API executes the exact pending red operation once', async () => {
  const note = noteStore.writeNote('star', 'isolated confirmation fixture')
  const context = contextModule.createToolContext({
    source: 'chat', actorId: 'lumbre-authenticated-user', sessionId: 'api-session',
  })
  const pending = JSON.parse(await executor.executeTool('delete_note', { note_id: note.id, author: 'star' }, context))
  assert.equal(readFileSync(path.join(root, 'tool-confirmations.json'), 'utf8').includes(note.id), false)

  const wrongSession = new NextRequest('http://localhost/api/tools/confirm', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: pending.confirmation.token, approve: true, session_id: 'wrong-session' }),
  })
  assert.equal((await confirmRoute.POST(wrongSession)).status, 409)
  assert.equal(noteStore.listNotes().some(item => item.id === note.id), true)

  const confirm = new NextRequest('http://localhost/api/tools/confirm', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: pending.confirmation.token, approve: true, session_id: 'api-session' }),
  })
  const response = await confirmRoute.POST(confirm)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).ok, true)
  assert.equal(noteStore.listNotes().some(item => item.id === note.id), false)
  assert.equal(existsSync(path.join(root, 'notes', `${note.id}.json.bak`)), true)
  assert.equal(readFileSync(path.join(root, 'tool-confirmations.json.bak'), 'utf8').includes(note.id), false)

  const replay = new NextRequest('http://localhost/api/tools/confirm', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: pending.confirmation.token, approve: true, session_id: 'api-session' }),
  })
  assert.equal((await confirmRoute.POST(replay)).status, 409)
})

test('audit API returns bounded privacy-minimized events', async () => {
  const request = new NextRequest('http://localhost/api/tools/audit?limit=2')
  const response = await auditRoute.GET(request)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const body = await response.json()
  assert.equal(Array.isArray(body.events), true)
  assert.equal(body.events.length <= 2, true)
  assert.equal(body.events.some((event: any) => event.tool === 'delete_note'), true)
  assert.equal(JSON.stringify(body.events).includes('isolated confirmation fixture'), false)
})

test('confirmation API rejects malformed tokens before touching storage', async () => {
  const request = new NextRequest('http://localhost/api/tools/confirm', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'short', approve: true }),
  })
  assert.equal((await confirmRoute.POST(request)).status, 400)
})
