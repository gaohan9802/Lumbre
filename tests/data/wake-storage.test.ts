import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-wake-storage-'))
process.env.DATA_DIR = root
let wake: typeof import('../../src/server/autowake')
let repository: typeof import('../../src/server/data/repositories/wake')

before(async () => {
  wake = await import('../../src/server/autowake')
  repository = await import('../../src/server/data/repositories/wake')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('wake configuration preserves behavior and serializes settings', () => {
  assert.equal(wake.loadWakeConfig().enabled, false)
  const updated = wake.updateWakeSettings({ enabled: true, sessionId: 'fixture-session', pushEnabled: true })
  assert.equal(updated.enabled, true)
  assert.equal(updated.sessionId, 'fixture-session')
  assert.equal(updated.day.enabled, true)
  assert.equal(updated.night.enabled, true)
  const alarm = wake.scheduleWake(Date.now() + 60_000, 'fixture alarm')
  assert.equal(wake.loadWakeConfig().alarms?.some(value => value.at === alarm.at), true)
})

test('independent wake rules clamp settings and wake_me bypasses recent activity', () => {
  const now = Date.parse('2026-09-07T10:00:00.000Z')
  const updated = wake.updateWakeSettings({
    day: { enabled: true, intervalHours: 99 },
    night: { enabled: false, intervalHours: 0 },
    random: { enabled: true, timesPerDay: 99 },
    inactivity: { enabled: true, afterHours: 0 },
    warmCache: { enabled: true },
  })
  assert.equal(updated.day.intervalHours, 12)
  assert.equal(updated.night.intervalHours, 1)
  assert.equal(updated.random.timesPerDay, 8)
  assert.equal(updated.inactivity.afterHours, 1)
  assert.equal(updated.warmCache.enabled, true)

  const alarm = { at: now - 1, note: 'forced fixture' }
  const decision = wake.decideWake({
    ...updated,
    sessionId: 'fixture-session',
    lastActivityAt: now - 5 * 60_000,
    alarms: [alarm],
  }, now)
  assert.equal(decision.trigger, 'alarm')
  assert.equal(decision.alarm, alarm)
})

test('inactivity fires once per quiet period and random times survive refreshes', () => {
  const now = Date.parse('2026-09-07T10:00:00.000Z')
  const config = wake.updateWakeSettings({
    sessionId: 'fixture-session',
    day: { enabled: false },
    night: { enabled: false },
    random: { enabled: true, timesPerDay: 3 },
    inactivity: { enabled: true, afterHours: 2 },
  })
  const quietAt = now - 3 * 60 * 60 * 1000
  const due = wake.decideWake({ ...config, lastActivityAt: quietAt, alarms: [], inactivity: { ...config.inactivity, handledActivityAt: 0 } }, now)
  assert.equal(due.trigger, 'inactivity')
  const handled = wake.decideWake({ ...config, lastActivityAt: quietAt, alarms: [], inactivity: { ...config.inactivity, handledActivityAt: quietAt } }, now)
  assert.equal(handled.should, false)

  const first = wake.refreshWakeSchedule(now)
  const second = wake.refreshWakeSchedule(now + 30_000)
  assert.equal(first.random.times.length, 3)
  assert.deepEqual(second.random.times, first.random.times)
  assert.equal(first.random.times.every(value => value > now), true)
})

test('a due wake_me alarm is consumed instead of postponed while generation is busy', () => {
  const alarm = wake.scheduleWake(Date.now() + 60_000, 'busy alarm fixture')
  wake.cancelWakeAlarmWhileBusy(alarm, Date.now())
  assert.equal(wake.loadWakeConfig().alarms?.some(value => value.at === alarm.at) ?? false, false)
  const log = wake.loadWakeLogs().at(-1)
  assert.equal(log?.trigger, 'alarm')
  assert.equal(log?.response, '[CANCELLED_BUSY]')
})

test('corrupt wake configuration is backed up before recovery', () => {
  const file = path.join(root, 'wake-config.json')
  writeFileSync(file, '{broken wake config', 'utf8')
  wake.updateWakeSettings({ enabled: true })
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), '{broken wake config')
  assert.equal(wake.loadWakeConfig().enabled, true)
})

test('wake logs append under lock, filter malformed entries, and retain the latest 200', () => {
  repository.appendWakeLogData(null)
  for (let index = 0; index < 205; index += 1) {
    repository.appendWakeLogData({ id: `log-${index}`, timestamp: index })
  }
  const logs = wake.loadWakeLogs()
  assert.equal(logs.length, 200)
  assert.equal(logs.at(-1)?.id, 'log-204')
  assert.equal(existsSync(path.join(root, 'wake-logs.json.bak')), true)
})

test('wake lease is exclusive and only its owner can release it', () => {
  assert.equal(repository.acquireWakeLeaseData('owner-one', 60_000), true)
  assert.equal(repository.acquireWakeLeaseData('owner-two', 60_000), false)
  repository.releaseWakeLeaseData('wrong-owner')
  assert.equal(repository.acquireWakeLeaseData('owner-two', 60_000), false)
  repository.releaseWakeLeaseData('owner-one')
  assert.equal(repository.acquireWakeLeaseData('owner-two', 60_000), true)
  repository.releaseWakeLeaseData('owner-two')
})

test('wake configuration keeps all alarms from concurrent processes', async () => {
  const worker = fileURLToPath(new URL('../fixtures/state-store-worker.ts', import.meta.url))
  const childRoot = path.join(root, 'concurrent')

  await Promise.all(Array.from({ length: 4 }, (_, index) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', worker, 'wake', '10', String(index)], {
      env: { ...process.env, DATA_DIR: childRoot },
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`)))
  })))

  const saved = JSON.parse(readFileSync(path.join(childRoot, 'wake-config.json'), 'utf8'))
  assert.equal(saved.alarms.length, 40)
  assert.equal(new Set(saved.alarms.map((alarm: any) => alarm.note)).size, 40)
})
