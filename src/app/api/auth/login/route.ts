import { NextRequest, NextResponse } from 'next/server'
import { authCookie, createSessionToken, getAuthPassword, isAuthConfigured, safeEqual } from '@/lib/auth'

export const runtime = 'nodejs'

const WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 8
const attempts = new Map<string, { count: number; resetAt: number }>()

function clientKey(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || request.headers.get('x-real-ip')
    || 'unknown'
}

function safeNext(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export async function POST(request: NextRequest) {
  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: '公网鉴权尚未配置。请在 Zeabur 设置 LUMBRE_ACCESS_PASSWORD，长度至少 12 位。' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const key = clientKey(request)
  const now = Date.now()
  const current = attempts.get(key)
  const state = !current || current.resetAt <= now ? { count: 0, resetAt: now + WINDOW_MS } : current
  if (state.count >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: '尝试次数过多，请 15 分钟后再试。' },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': String(Math.ceil((state.resetAt - now) / 1000)) } },
    )
  }

  let body: { password?: unknown; next?: unknown }
  try { body = await request.json() } catch { body = {} }
  const password = typeof body.password === 'string' ? body.password : ''

  if (!safeEqual(password, getAuthPassword())) {
    state.count += 1
    attempts.set(key, state)
    return NextResponse.json(
      { error: '密码不正确。' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  attempts.delete(key)
  const session = await createSessionToken(now)
  const response = NextResponse.json(
    { ok: true, next: safeNext(body.next) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
  response.cookies.set(authCookie.name, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    expires: session.expires,
    maxAge: authCookie.maxAge,
  })
  return response
}
