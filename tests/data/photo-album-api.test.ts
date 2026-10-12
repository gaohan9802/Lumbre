import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { NextRequest } from 'next/server'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-photo-album-api-'))
process.env.DATA_DIR = root
let photos: typeof import('../../src/server/photo-store')
let getAlbums: typeof import('../../src/app/api/photos/albums/route').GET

before(async () => {
  photos = await import('../../src/server/photo-store')
  getAlbums = (await import('../../src/app/api/photos/albums/route')).GET
})
after(() => rmSync(root, { recursive: true, force: true }))

test('album share returns the complete lightweight photo index', async () => {
  const album = photos.createPhotoAlbum('一起看', 'travel')
  const photo = photos.writePhoto({ author: 'fire', url: 'https://example.test/photo.jpg', caption: '海边', albumId: album.id })
  const response = await getAlbums(new NextRequest(`http://lumbre.test/api/photos/albums?share=${album.id}`))
  const body = await response.json()

  assert.equal(response.status, 200)
  assert.equal(body.album.id, album.id)
  assert.equal(body.photo_count, 1)
  assert.deepEqual(body.photos[0], {
    id: photo.id, author: 'fire', caption: '海边', created_at: photo.created_at, url: 'https://example.test/photo.jpg',
  })
})

test('album share rejects an unknown album', async () => {
  const response = await getAlbums(new NextRequest('http://lumbre.test/api/photos/albums?share=missing'))
  assert.equal(response.status, 404)
})
