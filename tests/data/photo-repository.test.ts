import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

import { DataPathError } from '../../src/server/data/errors'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-photo-repository-'))
process.env.DATA_DIR = root
let photos: typeof import('../../src/server/photo-store')

before(async () => { photos = await import('../../src/server/photo-store') })
after(() => rmSync(root, { recursive: true, force: true }))

test('photo repository keeps the existing file layout and CRUD behavior', () => {
  const photo = photos.writePhoto({ author: 'fire', url: 'data:image/gif;base64,fixture', caption: 'before' })
  assert.equal(photos.editPhoto(photo.id, { caption: 'after', locked: true }), 'ok')
  assert.equal(photos.commentPhoto(photo.id, 'star', 'comment'), 'ok')
  const saved = photos.getPhoto(photo.id)
  assert.equal(saved?.caption, 'after')
  assert.equal(saved?.locked, true)
  assert.equal(saved?.comments[0]?.content, 'comment')
  assert.equal(existsSync(path.join(root, 'photos', `${photo.id}.json`)), true)
})

test('photo identifiers cannot escape the photos directory', () => {
  for (const id of ['../config', '/persistent/config', 'nested/name', 'nested\\name']) {
    assert.throws(() => photos.getPhoto(id), DataPathError)
    assert.throws(() => photos.deletePhoto(id), DataPathError)
  }
})

test('corrupt photo metadata is isolated and deletion remains recoverable', () => {
  const file = path.join(root, 'photos', 'corrupt-photo.json')
  writeFileSync(file, '{broken photo json', 'utf8')
  assert.equal(photos.getPhoto('corrupt-photo'), null)
  assert.equal(photos.listPhotos().some(photo => photo.id === 'corrupt-photo'), false)
  assert.equal(photos.deletePhoto('corrupt-photo'), 'ok')
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), '{broken photo json')
})
