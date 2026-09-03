import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { fileURLToPath } from 'node:url'

import { DataPathError } from '../../src/server/data/errors'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-memory-repository-'))
process.env.DATA_DIR = root
let brain: typeof import('../../src/server/brain')
let repository: typeof import('../../src/server/data/repositories/memory')

before(async () => {
  brain = await import('../../src/server/brain')
  repository = await import('../../src/server/data/repositories/memory')
})
after(() => rmSync(root, { recursive: true, force: true }))

function fixtureBucket(id = 'abcdef123456'): import('../../src/server/brain').Bucket {
  const now = new Date().toISOString()
  return {
    id,
    metadata: {
      id,
      name: 'memory fixture',
      type: 'dynamic',
      domain: ['test'],
      tags: ['safe'],
      valence: 0.5,
      arousal: 0.4,
      importance: 5,
      resolved: false,
      pinned: false,
      digested: false,
      created: now,
      last_active: now,
      activation_count: 0,
    },
    content: 'before',
    score: 0,
  }
}

test('memory CRUD preserves the existing bucket layout and backs up deletion', () => {
  const bucket = fixtureBucket()
  brain.saveBucket(bucket)
  const file = path.join(root, 'buckets', `${bucket.id}.json`)

  assert.equal(brain.getBucket(bucket.id)?.content, 'before')
  assert.equal(brain.editBucket(bucket.id, { content: 'after', importance: 8 })?.content, 'after')
  assert.equal(brain.togglePin(bucket.id)?.metadata.pinned, true)
  assert.equal(brain.toggleResolve(bucket.id)?.metadata.resolved, true)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).metadata.importance, 8)

  assert.equal(brain.deleteBucket(bucket.id), true)
  assert.equal(existsSync(file), false)
  assert.equal(JSON.parse(readFileSync(`${file}.bak`, 'utf8')).content, 'after')
})

test('memory repository rejects unsafe bucket ids and reports missing edits cleanly', () => {
  for (const id of ['../config', '/persistent/config.json', 'not-hex-id!']) {
    assert.throws(() => brain.editBucket(id, { content: 'bad' }), DataPathError)
  }
  assert.equal(brain.editBucket('000000000000', { content: 'missing' }), null)
})

test('internal and malformed files cannot masquerade as memory buckets', () => {
  const directory = path.join(root, 'buckets')
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, '.dashboard_auth.json'), JSON.stringify({ token: 'private' }), 'utf8')
  writeFileSync(path.join(directory, 'families.json'), JSON.stringify([{ id: 'not-a-bucket' }]), 'utf8')
  writeFileSync(path.join(directory, '123456789abc.json'), '{broken bucket json', 'utf8')
  writeFileSync(path.join(directory, 'fedcba654321.json'), JSON.stringify({ ...fixtureBucket('aaaaaaaaaaaa'), id: 'wrong-file-id' }), 'utf8')

  const ids = brain.loadAllBuckets().map(bucket => bucket.id)
  assert.equal(ids.includes('123456789abc'), false)
  assert.equal(ids.includes('wrong-file-id'), false)
  assert.equal(ids.includes('not-a-bucket'), false)
})

test('memory updates are serialized across multiple Node processes', async () => {
  const id = '112233aabbcc'
  repository.writeMemoryBucket(id, { activation_count: 0 })
  const worker = fileURLToPath(new URL('../fixtures/memory-update-worker.ts', import.meta.url))

  await Promise.all(Array.from({ length: 4 }, () => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', worker, id, '25'], {
      env: { ...process.env, DATA_DIR: root },
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`)))
  })))

  assert.deepEqual(repository.readMemoryBucket(id), { activation_count: 100 })
})
