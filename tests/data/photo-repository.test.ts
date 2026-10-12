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
  const photo = photos.writePhoto({ author: 'fire', url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', caption: 'before' })
  assert.equal(photos.editPhoto(photo.id, { caption: 'after', locked: true }), 'ok')
  assert.equal(photos.commentPhoto(photo.id, 'star', 'comment'), 'ok')
  const saved = photos.getPhoto(photo.id)
  assert.equal(saved?.caption, 'after')
  assert.equal(saved?.locked, true)
  assert.equal(saved?.comments[0]?.content, 'comment')
  assert.equal(existsSync(path.join(root, 'photos', `${photo.id}.json`)), true)
  assert.equal(existsSync(path.join(root, 'photos', 'assets', `${photo.id}.gif`)), true)
  assert.doesNotMatch(readFileSync(path.join(root, 'photos', `${photo.id}.json`), 'utf8'), /R0lGOD/)
})

test('legacy base64 records migrate safely and albums filter without losing metadata', () => {
  const id = 'legacy-photo'
  const file = path.join(root, 'photos', `${id}.json`)
  writeFileSync(file, JSON.stringify({
    id, author: 'fire', url: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', caption: 'legacy', locked: false,
    comments: [{ author: 'star', content: 'keep me', time: '2026-10-12T00:00:00.000Z' }], created_at: '2026-10-12T00:00:00.000Z', updated_at: null,
  }), 'utf8')
  const migrated = photos.getPhoto(id)
  assert.equal(migrated?.album_id, 'wall-daily')
  assert.equal(migrated?.comments[0]?.content, 'keep me')
  assert.equal(existsSync(`${file}.bak`), true)
  assert.equal(existsSync(path.join(root, 'photos', 'assets', `${id}.gif`)), true)

  const album = photos.createPhotoAlbum('东京', 'travel')
  assert.equal(photos.editPhoto(id, { albumId: album.id }), 'ok')
  assert.equal(photos.listPhotoPage({ zone: 'travel', albumId: album.id }).photos[0]?.id, id)
  assert.equal(photos.deletePhotoAlbum(album.id), 'not_empty')
})

test('photo thumbnails are generated once as small webp files', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
  const photo = photos.writePhoto({ author: 'fire', url: png })
  const thumbnail = await photos.photoThumbnail(photo.id)
  assert.equal(thumbnail?.mime, 'image/webp')
  assert.equal((thumbnail?.bytes?.length || 0) > 0, true)
  assert.equal(existsSync(path.join(root, 'photos', 'thumbs', `${photo.id}.webp`)), true)
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
