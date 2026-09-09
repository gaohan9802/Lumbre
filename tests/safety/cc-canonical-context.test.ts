import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'lumbre-cc-canonical-'))
process.env.DATA_DIR = dir
after(() => rmSync(dir, { recursive: true, force: true }))

test('CC history uses the durable message unless the browser has a newer explicit version', async () => {
  const sync = await import('../../src/server/chat-sync')
  const { createCcChatResponse } = await import('../../src/server/chat/cc-gateway')
  const conversationId = 'conversation-canonical'
  sync.upsertSyncSessionMessage(conversationId, {
    id: 'old-reply', role: 'assistant', route: 'api', content: 'durable reply', timestamp: 10,
  }, { title: 'fixture' })

  const previous = {
    url: process.env.LUMBRE_CC_GATEWAY_URL,
    secret: process.env.LUMBRE_CC_GATEWAY_SECRET,
  }
  process.env.LUMBRE_CC_GATEWAY_URL = 'https://cc-gateway.example'
  process.env.LUMBRE_CC_GATEWAY_SECRET = 'cc-canonical-fixture-secret-000000000'
  const submitted: any[] = []
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input)
    if (url.endsWith('/v1/attempts')) {
      submitted.push(JSON.parse(String(init?.body)))
      return Response.json({ attempt: { id: `attempt-${submitted.length}`, status: 'queued' } }, { status: 202 })
    }
    if (url.includes('/events')) return new Response(`data: ${JSON.stringify({ id: 1, type: 'completed' })}\n\n`)
    return Response.json({ attempt: { status: 'completed', result: { text: 'ok', sessionId: 'session-id', usage: {} } } })
  }

  try {
    for (const [turn, oldContent, oldTimestamp] of [['turn-1', 'stale copy', 10], ['turn-2', 'edited reply', 11]] as const) {
      const response = await createCcChatResponse({
        body: {
          stream: true, session_id: conversationId, turn_id: turn,
          messages: [
            { id: 'old-reply', role: 'assistant', route: 'api', content: oldContent, timestamp: oldTimestamp },
            { id: turn, role: 'user', route: 'claude-code', content: 'hello', timestamp: 20 },
          ],
        },
        system: 'system', volatileContext: '', fetchImpl: fakeFetch,
      })
      await response.text()
    }
    assert.equal(submitted[0].context.messages[0].content, 'durable reply')
    assert.equal(submitted[1].context.messages[0].content, 'edited reply')
  } finally {
    if (previous.url === undefined) delete process.env.LUMBRE_CC_GATEWAY_URL
    else process.env.LUMBRE_CC_GATEWAY_URL = previous.url
    if (previous.secret === undefined) delete process.env.LUMBRE_CC_GATEWAY_SECRET
    else process.env.LUMBRE_CC_GATEWAY_SECRET = previous.secret
  }
})
