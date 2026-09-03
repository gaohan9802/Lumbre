import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-single-file-stores-'))
process.env.DATA_DIR = root
let encouragements: typeof import('../../src/server/encouragement-store')
let coupons: typeof import('../../src/server/coupon-store')

before(async () => {
  encouragements = await import('../../src/server/encouragement-store')
  coupons = await import('../../src/server/coupon-store')
})
after(() => rmSync(root, { recursive: true, force: true }))

test('encouragement read-modify-write operations keep the existing JSON array layout', () => {
  const item = encouragements.createEncouragement('fixture encouragement')
  assert.equal(encouragements.updateEncouragement(item.id, { enabled: false }).enabled, false)
  assert.equal(encouragements.listEncouragements()[0]?.text, 'fixture encouragement')
  const file = path.join(root, 'timeline', 'encouragements.json')
  assert.equal(Array.isArray(JSON.parse(readFileSync(file, 'utf8'))), true)
  assert.equal(existsSync(`${file}.bak`), true)
  assert.equal(encouragements.deleteEncouragement(item.id), true)
})

test('coupon lifecycle remains compatible while updates share one file lock', () => {
  const coupon = coupons.createCoupon({ name: 'fixture coupon', issuer: 'fire' }, 'fire')
  assert.equal(coupons.signCoupon(coupon.id, 'star').status, 'active')
  assert.equal(coupons.updateCoupon(coupon.id, { description: 'updated' }, 'fire').description, 'updated')
  assert.equal(coupons.useCoupon(coupon.id, 'star').status, 'used')
  const file = path.join(root, 'coupons', 'coupons.json')
  const saved = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(saved.coupons[0].name, 'fixture coupon')
  assert.equal(saved.coupons[0].usedCount, 1)
})

test('corrupt single-file data is preserved before a recovery write', () => {
  const file = path.join(root, 'timeline', 'encouragements.json')
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, '{broken encouragement json', 'utf8')
  assert.deepEqual(encouragements.listEncouragements(), [])
  encouragements.createEncouragement('recovered')
  assert.equal(readFileSync(`${file}.bak`, 'utf8'), '{broken encouragement json')
})
