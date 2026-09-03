import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

import { DataPathError } from '../../src/server/data/errors'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-journal-repository-'))
process.env.DATA_DIR = root
let journal: typeof import('../../src/server/diary-store')

before(async () => { journal = await import('../../src/server/diary-store') })
after(() => rmSync(root, { recursive: true, force: true }))

test('diary repository preserves file layout, visibility, comments, updates, and deletion backup', () => {
  const entry = journal.writeDiary({
    date: '2026-09-03', author: 'fire', title: 'fixture', content: 'before', visibility: 'public', tags: 'one two',
  })
  const file = path.join(root, 'diaries', `2026-09-03_${entry.time_id}_fire.json`)
  assert.equal(existsSync(file), true)
  assert.equal(journal.commentDiary(entry.date, entry.author, 'star', 'comment', entry.time_id), 'ok')
  assert.equal(journal.updateDiary(entry.date, entry.author, 'after', entry.time_id), 'ok')
  assert.match(JSON.parse(readFileSync(file, 'utf8')).content, /before\n\nafter/)
  assert.equal(journal.deleteDiary(entry.date, entry.author, entry.time_id), 'ok')
  assert.equal(existsSync(file), false)
  assert.equal(existsSync(`${file}.bak`), true)
})

test('notes preserve layout, serialize concurrent-style changes, and enforce deletion ownership', () => {
  const note = journal.writeNote('fire', 'fixture note', 'tag')
  const file = path.join(root, 'notes', `${note.id}.json`)
  assert.equal(journal.replyNote(note.id, 'star', 'reply'), 'ok')
  assert.equal(journal.deleteNote(note.id, 'star'), 'forbidden')
  assert.equal(existsSync(file), true)
  assert.equal(journal.deleteNote(note.id, 'fire'), 'ok')
  assert.equal(readFileSync(`${file}.bak`, 'utf8').includes('reply'), true)
})

test('journal rejects unsafe client path fields while isolating corrupt legacy files', () => {
  assert.throws(() => journal.readDiaries('fire', { target_date: '../config' }), DataPathError)
  assert.throws(() => journal.writeDiary({
    date: '2026-02-30', author: 'fire', title: 'bad', content: 'bad', visibility: 'public',
  }), DataPathError)
  assert.throws(() => journal.replyNote('../config', 'fire', 'bad'), DataPathError)

  const malformed = path.join(root, 'diaries', 'undefined_1004_undefined.json')
  mkdirSync(path.dirname(malformed), { recursive: true })
  writeFileSync(malformed, '{broken legacy diary', 'utf8')
  assert.doesNotThrow(() => journal.readDiaries('fire'))
  assert.equal(existsSync(malformed), true)
})

test('password updates preserve unrelated config fields and recover corrupt config with a backup', () => {
  const config = path.join(root, 'config.json')
  writeFileSync(config, JSON.stringify({ other: { keep: true }, passwords: { star: 'old' } }), 'utf8')
  journal.setPassword('fire', 'fixture-password')
  const saved = JSON.parse(readFileSync(config, 'utf8'))
  assert.equal(saved.other.keep, true)
  assert.equal(saved.passwords.star, 'old')
  assert.equal(journal.checkPassword('fire', 'fixture-password'), true)

  writeFileSync(config, '{broken config', 'utf8')
  journal.setPassword('fire', 'recovered-password')
  assert.equal(readFileSync(`${config}.bak`, 'utf8'), '{broken config')
  assert.equal(journal.hasPassword('fire'), true)
})
