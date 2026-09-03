import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'

import { getDataDir } from '../../src/server/data/config'
import { DataCorruptionError, DataPathError } from '../../src/server/data/errors'
import { readJsonFile, removeJsonFile, updateJsonFile, writeJsonFile } from '../../src/server/data/json-file'
import { withFileLock } from '../../src/server/data/lock'
import { resolveDataPath } from '../../src/server/data/safe-path'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-data-layer-'))
after(() => rmSync(root, { recursive: true, force: true }))

test('data directory must be absolute and can be overridden for isolated tests', () => {
  assert.equal(getDataDir({ DATA_DIR: root }), path.resolve(root))
  assert.throws(
    () => getDataDir({ DATA_DIR: '../relative' }),
    DataPathError,
  )
})

test('safe paths stay inside the data root and reject traversal-like segments', () => {
  assert.equal(resolveDataPath(root, 'todos', '2026-09-03.json'), path.join(root, 'todos', '2026-09-03.json'))
  for (const segment of ['..', '../secret', '/etc/passwd', 'nested/name', 'nested\\name', '\0bad']) {
    assert.throws(() => resolveDataPath(root, segment), DataPathError)
  }
})

test('JSON reads distinguish missing data from corrupt or structurally invalid data', () => {
  const missing = path.join(root, 'missing.json')
  assert.deepEqual(readJsonFile(missing, { fallback: () => ({ items: [] }) }), { items: [] })

  const corrupt = path.join(root, 'corrupt.json')
  writeFileSync(corrupt, '{not json', 'utf8')
  assert.throws(() => readJsonFile(corrupt), DataCorruptionError)

  const invalid = path.join(root, 'invalid.json')
  writeFileSync(invalid, JSON.stringify({ items: 'wrong' }), 'utf8')
  assert.throws(
    () => readJsonFile(invalid, { validate: value => !!value && typeof value === 'object' && Array.isArray((value as any).items) }),
    DataCorruptionError,
  )
})

test('atomic JSON writes retain the previous readable version as a backup', () => {
  const file = path.join(root, 'atomic', 'state.json')
  writeJsonFile(file, { version: 1 })
  writeJsonFile(file, { version: 2 })

  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 2 })
  assert.deepEqual(JSON.parse(readFileSync(`${file}.bak`, 'utf8')), { version: 1 })
  assert.equal(readdirSync(path.dirname(file)).some(name => name.endsWith('.tmp')), false)
})

test('explicit recovery preserves corrupt input in the backup before replacing it', () => {
  const file = path.join(root, 'recovery', 'state.json')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, '{broken json', 'utf8')
  const next = updateJsonFile(
    file,
    { fallback: () => ({ items: [] as string[] }), fallbackOnInvalid: true, validate: value => Array.isArray((value as any)?.items) },
    current => ({ items: [...current.items, 'recovered'] }),
  )
  assert.deepEqual(next, { items: ['recovered'] })
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), '{broken json')
})

test('safe deletion retains the exact previous file as a backup', () => {
  const file = path.join(root, 'deletion', 'state.json')
  writeJsonFile(file, { keep: 'before delete' })
  assert.equal(removeJsonFile(file), true)
  assert.equal(existsSync(file), false)
  assert.deepEqual(JSON.parse(readFileSync(`${file}.bak`, 'utf8')), { keep: 'before delete' })
  assert.equal(removeJsonFile(file), false)
})

test('locked read-modify-write updates do not leave locks behind', () => {
  const file = path.join(root, 'updates', 'counter.json')
  writeJsonFile(file, { value: 0 })
  for (let i = 0; i < 20; i += 1) {
    updateJsonFile(
      file,
      { fallback: () => ({ value: 0 }), validate: value => typeof (value as any)?.value === 'number' },
      current => ({ value: current.value + 1 }),
    )
  }
  assert.deepEqual(readJsonFile(file), { value: 20 })
  assert.equal(existsSync(`${file}.lock`), false)
})

test('stale filesystem locks are reclaimed and active locks time out', () => {
  const file = path.join(root, 'locks', 'state.json')
  mkdirSync(path.dirname(file), { recursive: true })
  mkdirSync(`${file}.lock`)
  const old = new Date(Date.now() - 60_000)
  utimesSync(`${file}.lock`, old, old)
  assert.equal(withFileLock(file, () => 'reclaimed', { staleMs: 1_000 }), 'reclaimed')

  mkdirSync(`${file}.lock`)
  assert.throws(() => withFileLock(file, () => 'never', { timeoutMs: 30, retryMs: 5, staleMs: 60_000 }))
  rmSync(`${file}.lock`, { recursive: true, force: true })
})

test('filesystem locks prevent lost updates across multiple Node processes', async () => {
  const file = path.join(root, 'multiprocess', 'counter.json')
  const worker = fileURLToPath(new URL('../fixtures/data-update-worker.ts', import.meta.url))
  writeJsonFile(file, { value: 0 })

  await Promise.all(Array.from({ length: 4 }, () => new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', worker, file, '25'], { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`worker exited with ${code}`)))
  })))

  assert.deepEqual(readJsonFile(file), { value: 100 })
})
