import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-push-storage-'))
process.env.DATA_DIR = root
let push: typeof import('../../src/server/push')
let repository: typeof import('../../src/server/data/repositories/push')

before(async () => {
  push = await import('../../src/server/push')
  repository = await import('../../src/server/data/repositories/push')
})
after(() => rmSync(root, { recursive: true, force: true }))

function subscription(endpoint: string) {
  return { endpoint, keys: { p256dh: `p256dh-${endpoint}`, auth: `auth-${endpoint}` } }
}

test('push subscriptions preserve layout, deduplicate endpoints, and remove safely', () => {
  assert.equal(push.savePushSubscription(subscription('https://push.example/one')), 1)
  assert.equal(push.savePushSubscription(subscription('https://push.example/one')), 1)
  assert.equal(push.savePushSubscription(subscription('https://push.example/two')), 2)
  assert.deepEqual(push.listPushSubscriptions().map(value => value.endpoint).sort(), [
    'https://push.example/one',
    'https://push.example/two',
  ])
  assert.equal(push.removePushSubscription('https://push.example/one'), 1)
})

test('corrupt subscription JSON is retained as a backup before recovery', () => {
  const file = path.join(root, 'push', 'subscriptions.json')
  writeFileSync(file, '{broken subscriptions', 'utf8')
  push.savePushSubscription(subscription('https://push.example/recovered'))
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), '{broken subscriptions')
})

test('VAPID keys are created once under lock and corrupt keys are recoverable', () => {
  const first = repository.getOrCreateVapidKeys(() => ({ publicKey: 'public-one', privateKey: 'private-one' }))
  const unchanged = repository.getOrCreateVapidKeys(() => ({ publicKey: 'public-two', privateKey: 'private-two' }))
  assert.deepEqual(first, unchanged)

  const file = path.join(root, 'push', 'vapid.json')
  writeFileSync(file, '{broken vapid keys', 'utf8')
  const recovered = repository.getOrCreateVapidKeys(() => ({ publicKey: 'public-new', privateKey: 'private-new' }))
  assert.deepEqual(recovered, { publicKey: 'public-new', privateKey: 'private-new' })
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), '{broken vapid keys')
})

test('push repository serializes concurrent subscription writes', async () => {
  const worker = fileURLToPath(new URL('../fixtures/state-store-worker.ts', import.meta.url))
  const childRoot = path.join(root, 'concurrent')

  await Promise.all(Array.from({ length: 4 }, (_, index) => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', worker, 'push', '10', `worker-${index}`], {
      env: { ...process.env, DATA_DIR: childRoot },
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`)))
  })))

  const saved = JSON.parse(readFileSync(path.join(childRoot, 'push', 'subscriptions.json'), 'utf8'))
  assert.equal(saved.length, 40)
})
