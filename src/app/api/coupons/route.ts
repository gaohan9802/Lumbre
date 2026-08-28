import { NextRequest, NextResponse } from 'next/server'
import { listCoupons, createCoupon, signCoupon, updateCoupon, useCoupon, requestVoid, confirmVoid } from '@/server/coupon-store'
export const dynamic = 'force-dynamic'
export async function GET() { return NextResponse.json({ coupons: listCoupons() }) }
export async function POST(req: NextRequest) { try { const b=await req.json(); const actor=b.actor==='star'?'star':'fire'; let coupon
  if(b.action==='add') coupon=createCoupon(b,actor); else if(b.action==='sign') coupon=signCoupon(b.id,actor); else if(b.action==='edit') coupon=updateCoupon(b.id,b.patch||b,actor); else if(b.action==='use') coupon=useCoupon(b.id,actor); else if(b.action==='void') coupon=requestVoid(b.id,actor); else if(b.action==='confirm_void') coupon=confirmVoid(b.id,actor); else throw new Error('未知操作')
  return NextResponse.json({ok:true,coupon})
} catch(e:any) { return NextResponse.json({error:e?.message||'coupon_error'},{status:400}) } }
