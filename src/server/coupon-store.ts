/** 双方签字承诺券包；所有数据永久保存于 DATA_DIR/coupons（线上为 /persistent）。 */
import fs from 'fs'
import path from 'path'
import { madridDateKey, parseMadridDateTime } from '@/lib/madrid-time'

const DIR = path.join(process.env.DATA_DIR || '/persistent', 'coupons')
const FILE = path.join(DIR, 'coupons.json')
export type CouponStatus = 'pending' | 'active' | 'unused' | 'used' | 'expired' | 'voided'
export type CouponParty = 'star' | 'fire'
export interface CouponHistory { action: string; actor: CouponParty; at: string; note?: string }
export interface Coupon {
  id: string; issuer: CouponParty; holder: CouponParty; name: string; description: string
  status: CouponStatus; issuedAt: string; usedAt?: string; expiresAt?: string
  issuerSigned: boolean; holderSigned: boolean; useLimit: number; usedCount: number
  reason: string; createdAt: string; updatedAt: string; history: CouponHistory[]
  voidRequestedBy?: CouponParty; voidRequestedAt?: string
}
interface Data { coupons: Coupon[] }
function ensure() { fs.mkdirSync(DIR, { recursive: true }) }
function read(): Data { ensure(); try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); return { coupons: Array.isArray(d.coupons) ? d.coupons : [] } } catch { return { coupons: [] } } }
function write(d: Data) { ensure(); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(d, null, 2)); fs.renameSync(tmp, FILE) }
function party(v: any): CouponParty { return v === 'star' ? 'star' : 'fire' }
function now() { return new Date().toISOString() }
function normalize(c: Coupon): Coupon {
  if (c.status !== 'voided' && c.status !== 'used' && c.expiresAt && Date.now() >= new Date(c.expiresAt).getTime()) c.status = 'expired'
  if (c.status === 'pending' && c.holderSigned) c.status = c.usedCount >= c.useLimit ? 'used' : 'active'
  if (c.status === 'active' && c.usedCount >= c.useLimit) c.status = 'used'
  return c
}
export function listCoupons(): Coupon[] { const d = read(); let changed = false; d.coupons = d.coupons.map(c => { const before = c.status; const x = normalize(c); changed ||= before !== x.status; return x }); if (changed) write(d); return d.coupons.sort((a,b) => {
  const ae = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity, be = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity
  if (ae !== be) return ae - be
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
}) }
export function getCoupon(id: string) { return listCoupons().find(c => c.id === id) || null }
function addHistory(c: Coupon, action: string, actor: CouponParty, note?: string) { c.history = [...(c.history || []), { action, actor, at: now(), ...(note ? { note } : {}) }]; c.updatedAt = now() }
export function createCoupon(input: any, actor: CouponParty): Coupon {
  const issuer = party(input.issuer || actor), holder = party(input.holder || (issuer === 'star' ? 'fire' : 'star'))
  const issuedAt = input.issuedAt ? (parseMadridDateTime(input.issuedAt)?.toISOString() || now()) : now()
  const expiresAt = input.expiresAt ? (parseMadridDateTime(input.expiresAt)?.toISOString() || undefined) : undefined
  const c: Coupon = { id: `coupon-${Date.now()}-${Math.random().toString(16).slice(2,8)}`, issuer, holder, name: String(input.name || '').trim().slice(0,120), description: String(input.description || '').trim().slice(0,5000), status: 'pending', issuedAt, expiresAt, issuerSigned: issuer === actor ? true : false, holderSigned: false, useLimit: Math.max(1, Math.min(999, Number(input.useLimit) || 1)), usedCount: 0, reason: String(input.reason || '').trim().slice(0,2000), createdAt: now(), updatedAt: now(), history: [] }
  if (!c.name) throw new Error('券的名字不能为空'); if (c.issuer !== actor) throw new Error('只能替自己签发')
  addHistory(c, 'issued', actor); const d = read(); d.coupons.push(c); write(d); return c
}
export function signCoupon(id: string, actor: CouponParty): Coupon {
  const d=read(), c=d.coupons.find(x=>x.id===id); if(!c) throw new Error('券不存在'); if(c.holder!==actor) throw new Error('只有持有人可以签字'); if(c.status!=='pending') throw new Error('这张券当前不能签字'); c.holderSigned=true; c.status='active'; addHistory(c,'holder_signed',actor); write(d); return normalize(c)
}
export function updateCoupon(id: string, patch: any, actor: CouponParty): Coupon {
  const d=read(), c=d.coupons.find(x=>x.id===id); if(!c) throw new Error('券不存在'); if(c.status==='voided'||c.status==='used'||c.status==='expired') throw new Error('当前状态不可编辑')
  if (patch.name !== undefined) c.name=String(patch.name).trim().slice(0,120); if(patch.description!==undefined)c.description=String(patch.description).slice(0,5000); if(patch.reason!==undefined)c.reason=String(patch.reason).slice(0,2000); if(patch.useLimit!==undefined)c.useLimit=Math.max(c.usedCount+1,Math.min(999,Number(patch.useLimit)||1)); if(patch.expiresAt!==undefined)c.expiresAt=patch.expiresAt ? (parseMadridDateTime(patch.expiresAt)?.toISOString() || c.expiresAt) : undefined
  addHistory(c,'edited',actor); write(d); return normalize(c)
}
export function useCoupon(id: string, actor: CouponParty): Coupon { const d=read(),c=d.coupons.find(x=>x.id===id); if(!c)throw new Error('券不存在'); normalize(c); if(c.holder!==actor)throw new Error('只有持有人可以使用'); if(c.status!=='active')throw new Error(`当前状态是 ${c.status}，不能使用`); if(c.usedCount>=c.useLimit)throw new Error('使用次数已达上限'); c.usedCount++; c.usedAt=now(); c.status=c.usedCount>=c.useLimit?'used':'active'; addHistory(c,'used',actor); write(d); return c }
export function requestVoid(id:string, actor:CouponParty): Coupon { const d=read(),c=d.coupons.find(x=>x.id===id);if(!c)throw new Error('券不存在'); if(c.status==='pending'&&c.issuer===actor){c.status='voided';addHistory(c,'voided_pending',actor);write(d);return c} if(c.status!=='active'&&c.status!=='unused')throw new Error('当前状态不能作废'); if(c.voidRequestedBy===actor)throw new Error('已发起作废申请，等待对方确认'); c.voidRequestedBy=actor;c.voidRequestedAt=now();addHistory(c,'void_requested',actor);write(d);return c }
export function confirmVoid(id:string, actor:CouponParty):Coupon { const d=read(),c=d.coupons.find(x=>x.id===id);if(!c)throw new Error('券不存在');if(!c.voidRequestedBy||c.voidRequestedBy===actor)throw new Error('没有等待你确认的作废申请');c.status='voided';addHistory(c,'void_confirmed',actor);write(d);return c }
export function couponContext(): string { const list=listCoupons(); return list.length ? '[券包状态]\n'+list.map(c=>`- ${c.name} | ${c.status} | 签发人:${c.issuer} 持有人:${c.holder} | ${c.usedCount}/${c.useLimit}次 | 券ID:${c.id}`).join('\n') : '[券包状态]\n暂无券' }
