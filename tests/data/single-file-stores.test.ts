import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'

const root = mkdtempSync(path.join(tmpdir(), 'lumbre-single-file-stores-'))
process.env.DATA_DIR = root
let coupons: typeof import('../../src/server/coupon-store')

before(async () => {
  coupons = await import('../../src/server/coupon-store')
})
after(() => rmSync(root, { recursive: true, force: true }))

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
