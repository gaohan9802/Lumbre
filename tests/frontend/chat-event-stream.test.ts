import assert from 'node:assert/strict'
import test from 'node:test'
import { readChatEventStream } from '../../src/features/chat/api/event-stream'

function chunkedResponse(chunks: string[]) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      // Intentionally leave the stream open after `done`, matching proxies
      // that otherwise made mobile Safari wait forever.
    },
  }))
}

test('chat stream survives SSE frames split across arbitrary network chunks', async () => {
  const response = chunkedResponse([
    'data: {"type":"te',
    'xt","content":"你"}\n\ndata: {"type":"text","content":"好"}\n',
    ': keepalive\n\ndata: not-json\n\ndata: {"type":"done","input_tokens":12}\n\n',
  ])
  const events = []
  for await (const event of readChatEventStream(response)) events.push(event)

  assert.deepEqual(events.map(event => event.type), ['text', 'text', 'done'])
  assert.equal(events.filter(event => event.type === 'text').map(event => event.content).join(''), '你好')
  assert.equal(events.at(-1)?.input_tokens, 12)
})

test('chat stream parses a final frame even without a trailing newline', async () => {
  const encoder = new TextEncoder()
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"type":"done","output_tokens":7}'))
      controller.close()
    },
  }))
  const events = []
  for await (const event of readChatEventStream(response)) events.push(event)
  assert.equal(events[0]?.output_tokens, 7)
})
