import assert from 'node:assert/strict'
import test from 'node:test'
import { WeChatBatcher, type BatchClock } from '../../src/server/wechat/batcher'

function fakeClock() {
  let now = 0
  let id = 0
  const timers = new Map<number, { at: number; callback: () => void }>()
  const clock: BatchClock = {
    setTimeout(callback, delayMs) {
      const timer = ++id
      timers.set(timer, { at: now + delayMs, callback })
      return timer as unknown as ReturnType<typeof setTimeout>
    },
    clearTimeout(timer) { timers.delete(timer as unknown as number) },
  }
  const advance = (delayMs: number) => {
    const target = now + delayMs
    while (true) {
      const next = Array.from(timers.entries()).filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      now = next[1].at
      timers.delete(next[0])
      next[1].callback()
    }
    now = target
  }
  return { clock, advance }
}

test('wechat batching resets the ten second silence window for every new message', () => {
  const { clock, advance } = fakeClock()
  const flushed: string[][] = []
  const batcher = new WeChatBatcher<string>(items => { flushed.push(items) }, 10_000, clock)

  batcher.add('一')
  advance(9_000)
  batcher.add('二')
  advance(9_000)
  batcher.add('三')
  advance(9_999)
  assert.deepEqual(flushed, [])
  advance(1)
  assert.deepEqual(flushed, [['一', '二', '三']])
})

test('wechat batching does not interrupt a sender who keeps adding messages', () => {
  const { clock, advance } = fakeClock()
  const flushed: string[][] = []
  const batcher = new WeChatBatcher<string>(items => { flushed.push(items) }, 10_000, clock)

  batcher.add('一')
  for (const value of ['二', '三', '四', '五', '六', '七']) { advance(9_000); batcher.add(value) }
  advance(9_000)
  assert.deepEqual(flushed, [])
  advance(1_000)
  assert.deepEqual(flushed, [['一', '二', '三', '四', '五', '六', '七']])
})
