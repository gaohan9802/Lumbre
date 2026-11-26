import assert from 'node:assert/strict'
import test from 'node:test'
import { toolResultForHistory, toolResultText } from '../../src/server/agent/results'

test('tool results stay complete until the gateway limit and mark real truncation', () => {
  const complete = 'x'.repeat(5000)
  assert.equal(toolResultText('read_guestbook', complete), complete)
  assert.equal(toolResultForHistory('read_guestbook', complete), complete)

  const truncated = toolResultText('read_guestbook', 'x'.repeat(20_000))
  assert.equal(truncated.length, 16_000)
  assert.match(truncated, /\n…\(truncated\)$/)
})
