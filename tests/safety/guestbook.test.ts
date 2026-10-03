import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { NextRequest } from 'next/server'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-guestbook-'))
process.env.DATA_DIR = root
process.env.LUMBRE_ACCESS_PASSWORD = 'main-home-password-for-tests'
process.env.LUMBRE_AUTH_SECRET = 'main-home-secret-for-tests'
process.env.LUMBRE_GUESTBOOK_PASSWORD = 'guestbook-password-for-tests'

let store: typeof import('../../src/server/guestbook-store')
let guestAuth: typeof import('../../src/server/guestbook-auth')
let mainAuth: typeof import('../../src/lib/auth')
let runtime: typeof import('../../src/server/tool-runtime')
let middleware: typeof import('../../src/middleware')
let sessionRoute: typeof import('../../src/app/api/guestbook/public/session/route')
let messagesRoute: typeof import('../../src/app/api/guestbook/public/messages/route')

before(async () => {
  store = await import('../../src/server/guestbook-store')
  guestAuth = await import('../../src/server/guestbook-auth')
  mainAuth = await import('../../src/lib/auth')
  runtime = await import('../../src/server/tool-runtime')
  middleware = await import('../../src/middleware')
  sessionRoute = await import('../../src/app/api/guestbook/public/session/route')
  messagesRoute = await import('../../src/app/api/guestbook/public/messages/route')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('the first guest nickname is permanent and all three identities stay distinct', () => {
  assert.equal(store.claimGuestNickname('月亮'), '月亮')
  assert.equal(store.claimGuestNickname('冒充的新昵称'), '月亮')
  const guest = store.writeGuestbookMessage('guest', '我要告状')
  const fire = store.writeGuestbookMessage('fire', '我听到了', guest.id)
  const star = store.writeGuestbookMessage('star', '我来解释', guest.id)
  const board = store.readGuestbook()

  assert.equal(board.guest_name, '月亮')
  assert.equal(board.messages[0].author, 'guest')
  assert.deepEqual(board.messages[0].replies.map(item => item.author), ['fire', 'star'])
  assert.equal(store.deleteGuestbookMessage('guest', guest.id, star.id), 'forbidden')
  assert.equal(store.deleteGuestbookMessage('star', guest.id, star.id), 'ok')
  assert.equal(store.deleteGuestbookMessage('fire', guest.id), 'ok')
  assert.equal(store.readGuestbook().messages[0].replies.length, 2)
})

test('guestbook sessions cannot become Lumbre sessions', async () => {
  const session = await guestAuth.createGuestbookSession()
  assert.equal(await guestAuth.verifyGuestbookSession(session.token), true)
  assert.equal(await mainAuth.verifySessionToken(session.token), false)
})

test('public messages require the separate guestbook cookie', async () => {
  const rejected = await messagesRoute.GET(new NextRequest('https://xsidereal.beer/api/guestbook/public/messages'))
  assert.equal(rejected.status, 401)
  const login = await sessionRoute.POST(new NextRequest('https://xsidereal.beer/api/guestbook/public/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'guestbook-password-for-tests' }),
  }))
  assert.equal(login.status, 200)
  const setCookie = login.headers.get('set-cookie') || ''
  assert.match(setCookie, /lumbre_guestbook=/)
  assert.match(setCookie, /Path=\//)
  assert.match(setCookie, /HttpOnly/)
  const cookie = setCookie.split(';')[0]
  const accepted = await messagesRoute.GET(new NextRequest('https://xsidereal.beer/api/guestbook/public/messages', { headers: { cookie } }))
  assert.equal(accepted.status, 200)
})

test('public access is limited to guestbook routes', async () => {
  const page = await middleware.middleware(new NextRequest('https://xsidereal.beer/guestbook'))
  const publicApi = await middleware.middleware(new NextRequest('https://xsidereal.beer/api/guestbook/public/session'))
  const privateApi = await middleware.middleware(new NextRequest('https://xsidereal.beer/api/guestbook'))
  assert.equal(page.headers.get('x-middleware-next'), '1')
  assert.equal(publicApi.headers.get('x-middleware-next'), '1')
  assert.equal(privateApi.status, 401)
})

test('agent guestbook writes always use the star identity', async () => {
  const result = JSON.parse(await runtime.executeRegisteredToolHandler('write_guestbook', { author: 'guest', content: '工具留言' }))
  assert.equal(result.message.author, 'star')
})
