import { NextRequest, NextResponse } from 'next/server'
import { claimGuestNickname, guestbookStatus, readGuestbook } from '@/server/guestbook-store'
import { createGuestbookSession, guestbookCookie, isGuestbookConfigured, verifyGuestbookPassword, verifyGuestbookSession } from '@/server/guestbook-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 8
const attempts = new Map<string, { count: number; resetAt: number }>()

function clientKey(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
}

export async function GET(request: NextRequest) {
  const authorized = await verifyGuestbookSession(request.cookies.get(guestbookCookie.name)?.value)
  return NextResponse.json({
    configured: isGuestbookConfigured(),
    claimed: guestbookStatus().claimed,
    authorized,
    guest_name: authorized ? readGuestbook(1).guest_name : undefined,
  }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  if (!isGuestbookConfigured()) {
    return NextResponse.json({ error: '告状簿尚未配置访问口令。' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  const key = clientKey(request)
  const now = Date.now()
  const current = attempts.get(key)
  const state = !current || current.resetAt <= now ? { count: 0, resetAt: now + WINDOW_MS } : current
  if (state.count >= MAX_ATTEMPTS) {
    return NextResponse.json({ error: '尝试次数过多，请 15 分钟后再试。' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((state.resetAt - now) / 1000)), 'Cache-Control': 'no-store' } })
  }

  const body = await request.json().catch(() => ({}))
  if (!verifyGuestbookPassword(body.password)) {
    state.count += 1
    attempts.set(key, state)
    return NextResponse.json({ error: '口令不正确。' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }

  let guestName = readGuestbook(1).guest_name
  if (!guestName) {
    try { guestName = claimGuestNickname(body.nickname) }
    catch (error: any) { return NextResponse.json({ error: error?.message || '请输入昵称' }, { status: 400 }) }
  }

  attempts.delete(key)
  const session = await createGuestbookSession(now)
  const response = NextResponse.json({ ok: true, guest_name: guestName }, { headers: { 'Cache-Control': 'no-store' } })
  response.cookies.set(guestbookCookie.name, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: session.expires,
    maxAge: guestbookCookie.maxAge,
  })
  return response
}
