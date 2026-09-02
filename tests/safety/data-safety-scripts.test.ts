import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-stage0-scripts-'))
const backupScript = fileURLToPath(new URL('../../scripts/persistent-backup.mjs', import.meta.url))
const sanitizerScript = fileURLToPath(new URL('../../scripts/sanitize-persistent.mjs', import.meta.url))

after(() => rmSync(root, { recursive: true, force: true }))

test('backup create and verify checks a SHA-256 inventory and JSON readability', () => {
  const source = path.join(root, 'backup-source')
  const backup = path.join(root, 'backup-output')
  mkdirSync(source)
  writeFileSync(path.join(source, 'state.json'), JSON.stringify({ content: 'private fixture' }))
  writeFileSync(path.join(source, 'asset.txt'), 'binary-like fixture')

  execFileSync(process.execPath, [backupScript, 'create', '--source', source, '--output', backup])
  const verified = JSON.parse(execFileSync(
    process.execPath,
    [backupScript, 'verify', '--backup', backup],
    { encoding: 'utf8' },
  ))
  assert.equal(verified.ok, true)
  assert.equal(verified.files, 2)
})

test('sanitizer redacts all private strings and unsafe filenames while preserving structure', () => {
  const source = path.join(root, 'sanitize-source')
  const output = path.join(root, 'sanitize-output')
  mkdirSync(source)
  writeFileSync(path.join(source, '私人.json'), JSON.stringify({
    content: 'private content',
    query: 'private query not tied to a known content key',
    apiKey: 'secret-key',
    email: 'person@example.com',
    url: 'https://private.example/path',
    role: 'user',
    color: '#aabbcc',
  }))
  writeFileSync(path.join(source, 'private.md'), 'must not enter the fixture')

  execFileSync(process.execPath, [sanitizerScript, '--source', source, '--output', output])
  const jsonName = readdirSync(output).find(name => name.endsWith('.json') && name !== 'sanitization-report.json')
  assert.match(jsonName || '', /^redacted-[0-9a-f]{12}\.json$/)
  const sanitized = JSON.parse(readFileSync(path.join(output, jsonName || ''), 'utf8'))
  assert.match(sanitized.content, /^\[redacted:[0-9a-f]{12}\]$/)
  assert.match(sanitized.query, /^\[redacted:[0-9a-f]{12}\]$/)
  assert.equal(sanitized.apiKey, '[REDACTED]')
  assert.match(sanitized.email, /^\[email:[0-9a-f]{12}\]@example\.invalid$/)
  assert.equal(sanitized.url, 'https://example.invalid/[redacted]')
  assert.equal(sanitized.role, 'user')
  assert.equal(sanitized.color, '#aabbcc')
  assert.doesNotMatch(JSON.stringify(sanitized), /private|secret-key|person@example\.com/)

  const report = JSON.parse(readFileSync(path.join(output, 'sanitization-report.json'), 'utf8'))
  assert.deepEqual({ written: report.written, skipped: report.skipped }, { written: 1, skipped: 1 })
  assert.equal(JSON.stringify(report).includes(source), false)
})
