/** 双方签字承诺券包；现有 DATA_DIR/coupons/coupons.json 布局保持不变。 */
import { parseMadridDateTime } from '@/lib/madrid-time'
import { getDataDir } from './data/config'
import { readJsonFile, updateJsonFile } from './data/json-file'
import { resolveDataPath } from './data/safe-path'

const FILE = resolveDataPath(getDataDir(), 'coupons', 'coupons.json')

export type CouponStatus = 'pending' | 'active' | 'unused' | 'used' | 'expired' | 'voided'
export type CouponParty = 'star' | 'fire'
export interface CouponHistory { action: string; actor: CouponParty; at: string; note?: string }
export interface Coupon {
  id: string
  issuer: CouponParty
  holder: CouponParty
  name: string
  description: string
  status: CouponStatus
  issuedAt: string
  usedAt?: string
  expiresAt?: string
  issuerSigned: boolean
  holderSigned: boolean
  useLimit: number
  usedCount: number
  reason: string
  createdAt: string
  updatedAt: string
  history: CouponHistory[]
  voidRequestedBy?: CouponParty
  voidRequestedAt?: string
}

interface Data { coupons: Coupon[] }

const readOptions = {
  fallback: (): Data => ({ coupons: [] }),
  fallbackOnInvalid: true,
  validate: (value: unknown) => !!value && typeof value === 'object' && Array.isArray((value as any).coupons),
}

function read(): Data {
  return readJsonFile(FILE, readOptions)
}

function mutate<T>(operation: (data: Data) => T): T {
  let result!: T
  updateJsonFile(FILE, readOptions, data => {
    result = operation(data)
    return data
  })
  return result
}

function party(value: any): CouponParty {
  return value === 'star' ? 'star' : 'fire'
}

function now(): string {
  return new Date().toISOString()
}

function normalize(coupon: Coupon): Coupon {
  if (
    coupon.status !== 'voided'
    && coupon.status !== 'used'
    && coupon.expiresAt
    && Date.now() >= new Date(coupon.expiresAt).getTime()
  ) coupon.status = 'expired'
  if (coupon.status === 'pending' && coupon.holderSigned) {
    coupon.status = coupon.usedCount >= coupon.useLimit ? 'used' : 'active'
  }
  if (coupon.status === 'active' && coupon.usedCount >= coupon.useLimit) coupon.status = 'used'
  return coupon
}

export function listCoupons(): Coupon[] {
  let coupons: Coupon[] = []
  updateJsonFile(FILE, readOptions, data => {
    let changed = false
    coupons = data.coupons.map(coupon => {
      const before = coupon.status
      const normalized = normalize(coupon)
      if (before !== normalized.status) changed = true
      return normalized
    })
    data.coupons = coupons
    return changed ? data : undefined
  })
  return coupons.sort((a, b) => {
    const aExpiry = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity
    const bExpiry = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity
    if (aExpiry !== bExpiry) return aExpiry - bExpiry
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })
}

export function getCoupon(id: string): Coupon | null {
  return listCoupons().find(coupon => coupon.id === id) || null
}

function addHistory(coupon: Coupon, action: string, actor: CouponParty, note?: string): void {
  coupon.history = [...(coupon.history || []), { action, actor, at: now(), ...(note ? { note } : {}) }]
  coupon.updatedAt = now()
}

export function createCoupon(input: any, actor: CouponParty): Coupon {
  const issuer = party(input.issuer || actor)
  const holder = party(input.holder || (issuer === 'star' ? 'fire' : 'star'))
  const issuedAt = input.issuedAt ? (parseMadridDateTime(input.issuedAt)?.toISOString() || now()) : now()
  const expiresAt = input.expiresAt ? (parseMadridDateTime(input.expiresAt)?.toISOString() || undefined) : undefined
  const coupon: Coupon = {
    id: `coupon-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    issuer,
    holder,
    name: String(input.name || '').trim().slice(0, 120),
    description: String(input.description || '').trim().slice(0, 5000),
    status: 'pending',
    issuedAt,
    expiresAt,
    issuerSigned: issuer === actor,
    holderSigned: false,
    useLimit: Math.max(1, Math.min(999, Number(input.useLimit) || 1)),
    usedCount: 0,
    reason: String(input.reason || '').trim().slice(0, 2000),
    createdAt: now(),
    updatedAt: now(),
    history: [],
  }
  if (!coupon.name) throw new Error('券的名字不能为空')
  if (coupon.issuer !== actor) throw new Error('只能替自己签发')
  addHistory(coupon, 'issued', actor)
  mutate(data => { data.coupons.push(coupon); return coupon })
  return coupon
}

export function signCoupon(id: string, actor: CouponParty): Coupon {
  return mutate(data => {
    const coupon = data.coupons.find(item => item.id === id)
    if (!coupon) throw new Error('券不存在')
    if (coupon.holder !== actor) throw new Error('只有持有人可以签字')
    if (coupon.status !== 'pending') throw new Error('这张券当前不能签字')
    coupon.holderSigned = true
    coupon.status = 'active'
    addHistory(coupon, 'holder_signed', actor)
    return normalize(coupon)
  })
}

export function deleteCoupon(id: string, actor: CouponParty): void {
  mutate(data => {
    const index = data.coupons.findIndex(item => item.id === id)
    if (index < 0) throw new Error('券不存在')
    const coupon = normalize(data.coupons[index])
    if (coupon.status !== 'expired') throw new Error('只能删除已过期的券')
    data.coupons.splice(index, 1)
  })
}

export function updateCoupon(id: string, patch: any, actor: CouponParty): Coupon {
  return mutate(data => {
    const coupon = data.coupons.find(item => item.id === id)
    if (!coupon) throw new Error('券不存在')
    if (coupon.status === 'voided' || coupon.status === 'used' || coupon.status === 'expired') throw new Error('当前状态不可编辑')
    if (patch.name !== undefined) coupon.name = String(patch.name).trim().slice(0, 120)
    if (patch.description !== undefined) coupon.description = String(patch.description).slice(0, 5000)
    if (patch.reason !== undefined) coupon.reason = String(patch.reason).slice(0, 2000)
    if (patch.useLimit !== undefined) coupon.useLimit = Math.max(coupon.usedCount + 1, Math.min(999, Number(patch.useLimit) || 1))
    if (patch.expiresAt !== undefined) {
      coupon.expiresAt = patch.expiresAt ? (parseMadridDateTime(patch.expiresAt)?.toISOString() || coupon.expiresAt) : undefined
    }
    addHistory(coupon, 'edited', actor)
    return normalize(coupon)
  })
}

export function useCoupon(id: string, actor: CouponParty): Coupon {
  return mutate(data => {
    const coupon = data.coupons.find(item => item.id === id)
    if (!coupon) throw new Error('券不存在')
    normalize(coupon)
    if (coupon.holder !== actor) throw new Error('只有持有人可以使用')
    if (coupon.status !== 'active') throw new Error(`当前状态是 ${coupon.status}，不能使用`)
    if (coupon.usedCount >= coupon.useLimit) throw new Error('使用次数已达上限')
    coupon.usedCount += 1
    coupon.usedAt = now()
    coupon.status = coupon.usedCount >= coupon.useLimit ? 'used' : 'active'
    addHistory(coupon, 'used', actor)
    return coupon
  })
}

export function requestVoid(id: string, actor: CouponParty): Coupon {
  return mutate(data => {
    const coupon = data.coupons.find(item => item.id === id)
    if (!coupon) throw new Error('券不存在')
    if (coupon.status === 'pending' && coupon.issuer === actor) {
      coupon.status = 'voided'
      addHistory(coupon, 'voided_pending', actor)
      return coupon
    }
    if (coupon.status !== 'active' && coupon.status !== 'unused') throw new Error('当前状态不能作废')
    if (coupon.voidRequestedBy === actor) throw new Error('已发起作废申请，等待对方确认')
    coupon.voidRequestedBy = actor
    coupon.voidRequestedAt = now()
    addHistory(coupon, 'void_requested', actor)
    return coupon
  })
}

export function confirmVoid(id: string, actor: CouponParty): Coupon {
  return mutate(data => {
    const coupon = data.coupons.find(item => item.id === id)
    if (!coupon) throw new Error('券不存在')
    if (!coupon.voidRequestedBy || coupon.voidRequestedBy === actor) throw new Error('没有等待你确认的作废申请')
    coupon.status = 'voided'
    addHistory(coupon, 'void_confirmed', actor)
    return coupon
  })
}

export function couponContext(): string {
  const list = listCoupons()
  return list.length
    ? '[券包状态]\n' + list.map(coupon => `- ${coupon.name} | ${coupon.status} | 签发人:${coupon.issuer} 持有人:${coupon.holder} | ${coupon.usedCount}/${coupon.useLimit}次 | 券ID:${coupon.id}`).join('\n')
    : '[券包状态]\n暂无券'
}
