import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../../src/components/chat/ChatView.tsx', import.meta.url), 'utf8')

test('chat send and retry acquire one synchronous lock before awaiting', () => {
  const send = source.slice(source.indexOf('const handleSend'), source.indexOf('/* ── retry'))
  const retry = source.slice(source.indexOf('const handleRetry'), source.indexOf('// If a tab refreshed'))
  assert.ok(send.indexOf('sendLockRef.current = true') < send.indexOf('await sendMessage'))
  assert.ok(retry.indexOf('sendLockRef.current = true') < retry.indexOf('await retryMessage'))
  assert.match(source, /disabled=\{sendStarting \|\|/)
})
