#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

function fail(message) {
  console.error(`persistent-backup: ${message}`)
  process.exit(1)
}

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function safeDirectory(value, label) {
  if (!value) fail(`${label} is required`)
  const resolved = path.resolve(value)
  if (resolved === path.parse(resolved).root) fail(`${label} cannot be a filesystem root`)
  return resolved
}

function inside(parent, candidate) {
  const rel = path.relative(parent, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function walkFiles(root, current = root) {
  const files = []
  for (const name of readdirSync(current).sort()) {
    const absolute = path.join(current, name)
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) fail(`symbolic links are not supported: ${path.relative(root, absolute)}`)
    if (stat.isDirectory()) files.push(...walkFiles(root, absolute))
    else if (stat.isFile()) files.push(absolute)
  }
  return files
}

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function fileInventory(root) {
  return walkFiles(root).map(file => ({
    path: path.relative(root, file),
    bytes: statSync(file).size,
    sha256: digest(file),
  }))
}

function currentCommit() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() }
  catch { return null }
}

function verify(backup) {
  const manifestPath = path.join(backup, 'backup-manifest.json')
  if (!existsSync(manifestPath)) fail(`manifest missing: ${manifestPath}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const data = path.join(backup, 'data')
  const actual = fileInventory(data)
  const expected = Array.isArray(manifest.files) ? manifest.files : []
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail('backup content does not match its SHA-256 manifest')
  for (const file of actual.filter(item => /\.(?:json|bak)$/i.test(item.path))) {
    JSON.parse(readFileSync(path.join(data, file.path), 'utf8'))
  }
  console.log(JSON.stringify({ ok: true, backup, files: actual.length, bytes: actual.reduce((n, f) => n + f.bytes, 0) }))
}

const command = process.argv[2]

if (command === 'create') {
  const source = safeDirectory(option('--source'), '--source')
  const output = safeDirectory(option('--output'), '--output')
  if (!existsSync(source) || !statSync(source).isDirectory()) fail(`source directory not found: ${source}`)
  if (inside(source, output)) fail('output must not be inside source')
  if (existsSync(output)) fail(`output already exists: ${output}`)
  const staging = `${output}.creating-${process.pid}`
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  try {
    const data = path.join(staging, 'data')
    cpSync(source, data, { recursive: true, errorOnExist: true, force: false })
    const files = fileInventory(data)
    const manifest = {
      format: 1,
      createdAt: new Date().toISOString(),
      source,
      baselineCommit: currentCommit(),
      files,
      totalBytes: files.reduce((n, file) => n + file.bytes, 0),
    }
    writeFileSync(path.join(staging, 'backup-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 })
    renameSync(staging, output)
    verify(output)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
} else if (command === 'verify') {
  verify(safeDirectory(option('--backup'), '--backup'))
} else {
  fail('usage: create --source DIR --output DIR | verify --backup DIR')
}
