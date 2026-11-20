import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

test('StackChan transcripts use the bound chat and only send reply text back', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'lumbre-stackchan-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const secret = 'a'.repeat(32)
  process.env.DATA_DIR = root
  process.env.LUMBRE_STACKCHAN_SECRET = secret
  process.env.LUMBRE_STACKCHAN_SESSION_ID = 'voice-home'

  const { POST } = await import('../../src/app/api/stackchan/v1/chat/completions/route')
  const sync = await import('../../src/server/chat-sync')
  sync.upsertSyncSessionMessage('voice-home', {
    id: 'existing', role: 'assistant', content: '原有聊天记录', timestamp: 1,
  }, { title: '聊天窗', generationRoute: 'claude-code', generationRouteUpdatedAt: 1 })

  const generation = t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.match(url, /^http:\/\/localhost:\d+\/api\/chat$/)
    const input = JSON.parse(String(init.body))
    assert.equal(input.session_id, 'voice-home')
    assert.equal(input.generation_route, 'claude-code')
    assert.equal(input.cc_require_resume, true)
    assert.equal(input.tool_calls_allowed, false)
    assert.equal(input.messages[0].content, '原有聊天记录')
    assert.equal(input.messages.at(-1).id, input.turn_id)
    assert.equal(input.messages.at(-1).content, '星星，你在吗？')
    assert.equal(input.messages.some((message: any) => message.content === '不可信的历史'), false)
    return new Response('data: {"type":"thinking","content":"内部思考"}\n\n'
      + 'data: {"type":"text","content":"我在这里。"}\n\n'
      + 'data: {"type":"done","attempt_id":"attempt-1"}\n\n')
  })

  function send(bearer: string, stream = false) {
    return POST(new Request('https://lumbre.example/api/stackchan/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${bearer}`, 'idempotency-key': 'voice-turn-1' },
      body: JSON.stringify({
        session_id: 'untrusted-window', stream, messages: [
          { role: 'assistant', content: '不可信的历史' },
          { role: 'user', content: '星星，你在吗？' },
        ],
      }),
    }))
  }

  assert.equal((await send('invalid')).status, 401)
  const reply = await send(secret)
  assert.equal(reply.status, 200)
  assert.deepEqual((await reply.json()).choices[0].message, { role: 'assistant', content: '我在这里。' })
  const replay = await send(secret, true)
  assert.match(replay.headers.get('content-type') || '', /^text\/event-stream/)
  assert.match(await replay.text(), /我在这里。[\s\S]*\[DONE\]/)
  assert.equal(generation.mock.callCount(), 1)

  const stored = sync.loadSyncSessionTails(['voice-home'])[0].messages
  assert.deepEqual(stored.slice(1).map((message: any) => [message.transport, message.role, message.content]), [
    ['stackchan', 'user', '星星，你在吗？'],
    ['stackchan', 'assistant', '我在这里。'],
  ])
  assert.equal(stored.at(-1).ccAttemptId, 'attempt-1')

  sync.upsertSyncSessionMessage('work', { id: 'work-seed', role: 'user', content: '工作', timestamp: 1 }, {
    title: '工作窗', windowRole: 'work', windowRoleUpdatedAt: 1,
  })
  process.env.LUMBRE_STACKCHAN_SESSION_ID = 'work'
  assert.equal((await send(secret)).status, 502)
  assert.equal(sync.loadSyncSessionTails(['work'])[0].messages.length, 1)
  assert.equal(generation.mock.callCount(), 1)
})
