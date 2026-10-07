import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
let privateRoute: typeof import('../../src/app/api/guestbook/route')

before(async () => {
  store = await import('../../src/server/guestbook-store')
  guestAuth = await import('../../src/server/guestbook-auth')
  mainAuth = await import('../../src/lib/auth')
  runtime = await import('../../src/server/tool-runtime')
  middleware = await import('../../src/middleware')
  sessionRoute = await import('../../src/app/api/guestbook/public/session/route')
  messagesRoute = await import('../../src/app/api/guestbook/public/messages/route')
  privateRoute = await import('../../src/app/api/guestbook/route')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('the first guest nickname is permanent and all three identities stay distinct', () => {
  assert.equal(store.claimGuestNickname('月亮'), '月亮')
  assert.equal(store.claimGuestNickname('冒充的新昵称'), '月亮')
  const guest = store.writeGuestbookMessage('guest', '我要告状')
  const fire = store.writeGuestbookMessage('fire', '我听到了', guest.id)
  const star = store.writeGuestbookMessage('star', '我来解释', guest.id, fire.id)
  const board = store.readGuestbook()

  assert.equal(board.guest_name, '月亮')
  assert.equal(board.messages[0].author, 'guest')
  assert.deepEqual(board.messages[0].replies.map(item => item.author), ['fire', 'star'])
  assert.equal(star.reply_to_author, 'fire')
  assert.equal(store.deleteGuestbookMessage('guest', guest.id, star.id), 'forbidden')
  assert.equal(store.deleteGuestbookMessage('star', guest.id, star.id), 'ok')
  assert.equal(store.deleteGuestbookMessage('fire', guest.id), 'forbidden')
  assert.deepEqual(store.readGuestbook().messages[0].replies.map(item => item.id), [fire.id])
  assert.equal(store.deleteGuestbookMessage('fire', guest.id, fire.id), 'ok')
  assert.equal(store.deleteGuestbookMessage('guest', guest.id), 'ok')
  assert.equal(store.readGuestbook().messages.length, 0)
})

test('private unread count tracks only new messages from other people', async () => {
  const first = await privateRoute.GET(new NextRequest('https://xsidereal.beer/api/guestbook?mode=unread'))
  assert.equal((await first.json()).unread, 0)

  const fire = store.writeGuestbookMessage('fire', '我自己写的')
  const star = store.writeGuestbookMessage('star', '星星的新留言')
  const guest = store.writeGuestbookMessage('guest', '访客的新留言')
  const unread = await privateRoute.GET(new NextRequest('https://xsidereal.beer/api/guestbook?mode=unread'))
  assert.equal((await unread.json()).unread, 2)

  const marked = await privateRoute.POST(new NextRequest('https://xsidereal.beer/api/guestbook', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'mark_read' }),
  }))
  assert.equal((await marked.json()).unread, 0)
  const after = await privateRoute.GET(new NextRequest('https://xsidereal.beer/api/guestbook?mode=unread'))
  assert.equal((await after.json()).unread, 0)

  assert.equal(store.deleteGuestbookMessage('fire', fire.id), 'ok')
  assert.equal(store.deleteGuestbookMessage('star', star.id), 'ok')
  assert.equal(store.deleteGuestbookMessage('guest', guest.id), 'ok')
})

test('each HTTP channel owns one fixed identity regardless of submitted actor', async () => {
  const guest = store.writeGuestbookMessage('guest', '访客的纸条')
  const fireWrite = await privateRoute.POST(new NextRequest('https://xsidereal.beer/api/guestbook', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'star', content: '私服页面留言' }),
  }))
  assert.equal((await fireWrite.json()).message.author, 'fire')

  const forgedDelete = await privateRoute.POST(new NextRequest('https://xsidereal.beer/api/guestbook', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'guest', action: 'delete', message_id: guest.id }),
  }))
  assert.equal(forgedDelete.status, 403)
  assert.equal(store.readGuestbook().messages.some(item => item.id === guest.id), true)
  assert.equal(store.deleteGuestbookMessage('guest', guest.id), 'ok')
})

test('legacy deletion markers are physically removed from the active data file', () => {
  const file = path.join(root, 'guestbook', 'board.json')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({
    guest_name: '月亮',
    messages: [
      { id: 'gone', author: 'fire', content: '', created_at: '2026-01-01T00:00:00.000Z', deleted: true, replies: [] },
      { id: 'kept', author: 'guest', content: '还在', created_at: '2026-01-01T00:00:00.000Z', replies: [
        { id: 'gone-reply', author: 'star', content: '', created_at: '2026-01-01T00:00:00.000Z', deleted: true },
      ] },
    ],
  }))

  assert.deepEqual(store.readGuestbook().messages.map(item => item.id), ['kept'])
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(JSON.stringify(saved).includes('deleted'), false)
  assert.deepEqual(saved.messages[0].replies, [])
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
  const guestWrite = await messagesRoute.POST(new NextRequest('https://xsidereal.beer/api/guestbook/public/messages', {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'fire', content: '访客留言' }),
  }))
  assert.equal((await guestWrite.json()).message.author, 'guest')
  const fire = store.writeGuestbookMessage('fire', '小火留言')
  const forgedDelete = await messagesRoute.POST(new NextRequest('https://xsidereal.beer/api/guestbook/public/messages', {
    method: 'POST', headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ actor: 'fire', action: 'delete', message_id: fire.id }),
  }))
  assert.equal(forgedDelete.status, 403)
})

test('public access is limited to guestbook routes', async () => {
  const page = await middleware.middleware(new NextRequest('https://xsidereal.beer/guestbook'))
  const publicApi = await middleware.middleware(new NextRequest('https://xsidereal.beer/api/guestbook/public/session'))
  const manifest = await middleware.middleware(new NextRequest('https://xsidereal.beer/guestbook-manifest.webmanifest'))
  const privateApi = await middleware.middleware(new NextRequest('https://xsidereal.beer/api/guestbook'))
  assert.equal(page.headers.get('x-middleware-next'), '1')
  assert.equal(publicApi.headers.get('x-middleware-next'), '1')
  assert.equal(manifest.headers.get('x-middleware-next'), '1')
  assert.equal(privateApi.status, 401)
})

test('agent guestbook writes always use the star identity', async () => {
  const result = JSON.parse(await runtime.executeRegisteredToolHandler('write_guestbook', { author: 'guest', content: '工具留言' }))
  assert.equal(result.message.author, 'star')
  const reply = JSON.parse(await runtime.executeRegisteredToolHandler('reply_guestbook', { message_id: result.message.id, content: '工具回复' }))
  assert.equal(reply.reply.author, 'star')
  assert.equal(reply.reply.reply_to_author, 'star')
})
