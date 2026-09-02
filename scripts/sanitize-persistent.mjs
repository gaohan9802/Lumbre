#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

function fail(message) {
  console.error(`sanitize-persistent: ${message}`)
  process.exit(1)
}

function option(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function directory(value, label) {
  if (!value) fail(`${label} is required`)
  const resolved = path.resolve(value)
  if (resolved === path.parse(resolved).root) fail(`${label} cannot be a filesystem root`)
  return resolved
}

function inside(parent, candidate) {
  const rel = path.relative(parent, candidate)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

const SECRET_KEYS = /(?:api.?key|token|secret|password|authorization|cookie|credential|refresh)/i
const KEEP_VALUES = new Set(['star', 'fire', 'public', 'private', 'timed', 'user', 'assistant', 'system', 'tool'])

function token(value, prefix = 'redacted') {
  const hash = createHash('sha256').update(String(value)).digest('hex').slice(0, 12)
  return `[${prefix}:${hash}]`
}

function sanitizedRelativePath(relative) {
  return relative.split(path.sep).map(component => {
    if (/^[A-Za-z0-9._-]+$/.test(component)) return component
    const extension = path.extname(component)
    return `redacted-${createHash('sha256').update(component).digest('hex').slice(0, 12)}${extension}`
  }).join(path.sep)
}

function sanitizeString(value) {
  if (value === '' || KEEP_VALUES.has(value)) return value
  if (value.startsWith('data:')) return 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `${token(value, 'email')}@example.invalid`
  if (/^https?:\/\//i.test(value)) return 'https://example.invalid/[redacted]'
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value
  return token(value)
}

function sanitize(value, key = '') {
  if (SECRET_KEYS.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map(item => sanitize(item, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitize(child, childKey)]))
  }
  if (typeof value !== 'string') return value
  return sanitizeString(value)
}

function processDirectory(sourceRoot, outputRoot, current = sourceRoot, report = { written: 0, skipped: 0, skippedByExtension: {} }) {
  for (const name of readdirSync(current).sort()) {
    const source = path.join(current, name)
    const relative = path.relative(sourceRoot, source)
    const destination = path.join(outputRoot, sanitizedRelativePath(relative))
    const stat = lstatSync(source)
    if (stat.isSymbolicLink()) fail(`symbolic links are not supported: ${relative}`)
    if (stat.isDirectory()) {
      mkdirSync(destination, { recursive: true })
      processDirectory(sourceRoot, outputRoot, source, report)
      continue
    }
    if (!stat.isFile()) continue
    mkdirSync(path.dirname(destination), { recursive: true })
    const raw = readFileSync(source, 'utf8')
    try {
      if (/\.jsonl$/i.test(name)) {
        const lines = raw.split(/\r?\n/).filter(Boolean).map(line => JSON.stringify(sanitize(JSON.parse(line))))
        writeFileSync(destination, lines.join('\n') + (lines.length ? '\n' : ''), { mode: 0o600 })
      } else if (/\.(?:json|bak)$/i.test(name)) {
        writeFileSync(destination, JSON.stringify(sanitize(JSON.parse(raw)), null, 2) + '\n', { mode: 0o600 })
      } else {
        const extension = path.extname(name).toLowerCase() || '[none]'
        report.skipped++
        report.skippedByExtension[extension] = (report.skippedByExtension[extension] || 0) + 1
        continue
      }
      report.written++
    } catch (error) {
      fail(`cannot parse ${relative}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return report
}

const source = directory(option('--source'), '--source')
const output = directory(option('--output'), '--output')
if (!existsSync(source) || !statSync(source).isDirectory()) fail(`source directory not found: ${source}`)
if (inside(source, output)) fail('output must not be inside source')
if (existsSync(output)) fail(`output already exists: ${output}`)
mkdirSync(output, { recursive: true, mode: 0o700 })
const report = processDirectory(source, output)
writeFileSync(path.join(output, 'sanitization-report.json'), JSON.stringify({
  format: 1,
  createdAt: new Date().toISOString(),
  written: report.written,
  skipped: report.skipped,
  skippedByExtension: report.skippedByExtension,
}, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify({ ok: true, output, written: report.written, skipped: report.skipped }))
