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
  const alarm = wake.scheduleWake(Date.now() + 60_000, 'fixture alarm')
  assert.equal(wake.loadWakeConfig().alarms?.some(value => value.at === alarm.at), true)
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
