import assert from 'node:assert/strict'
import test from 'node:test'
import { createCoalescingRunner } from '../../src/lib/coalescingRunner'

test('a sync requested in flight always gets one follow-up pass', async () => {
  let calls = 0
  let releaseFirst!: () => void
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve })
  const run = createCoalescingRunner(async () => {
    calls += 1
    if (calls === 1) await firstGate
  })

  const first = run()
  const second = run()
  const third = run()
  assert.equal(first, second)
  assert.equal(second, third)
  assert.equal(calls, 1)

  releaseFirst()
  await first
  assert.equal(calls, 2)

  await run()
  assert.equal(calls, 3)
})
