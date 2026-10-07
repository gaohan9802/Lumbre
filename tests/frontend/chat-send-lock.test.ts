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

test('a transient CC outage keeps the turn and refreshes status automatically', () => {
  const send = source.slice(source.indexOf('const sendMessage'), source.indexOf('const handleSend'))
  assert.match(send, /void ensureCcAvailable\(activeRoute, false\)/)
  assert.doesNotMatch(send, /await ensureCcAvailable\(activeRoute, false\)/)
  assert.doesNotMatch(send, /if \(!await ensureCcAvailable/)
  assert.match(source, /setInterval\(refresh, !ccStatus\.available \? 5_000/)
  assert.match(source, /setCcRecoveryTick\(current => current \+ 1\)/)
})

test('a nose poke appears before its request finishes', () => {
  const poke = source.slice(source.indexOf('const pokeLeopardNose'), source.indexOf('const readCcStatus'))
  assert.ok(poke.indexOf('setNosePokes(current => [...current, optimisticPoke])') < poke.indexOf("await fetch('/api/nose-pokes'"))
  assert.match(poke, /filter\(poke => poke\.id !== optimisticPoke\.id\)/)
})
