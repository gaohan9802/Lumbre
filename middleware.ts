import { NextRequest, NextResponse } from 'next/server'
import { authCookie, isAuthConfigured, verifySessionToken } from './src/lib/auth'
import { shouldBlockDebugApi } from './src/server/safety-baseline'

const PUBLIC_PATHS = new Set([
  '/login',
  '/api/auth/login',
  '/manifest.json',
  '/sw.js',
  '/favicon.png',
  '/logo-pwa.jpg',
  '/apple-touch-icon.png',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-1024.png',
])

function securityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)')
  return response
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl
  const isPublic = PUBLIC_PATHS.has(pathname) || pathname.startsWith('/_next/')

  if (isPublic) return securityHeaders(NextResponse.next())

  // Do not expose filesystem probes, source inspection or model-call diagnostics
  // in a production deployment, even to an authenticated browser session.
  if (shouldBlockDebugApi(pathname)) {
    return securityHeaders(NextResponse.json(
      { error: 'Not Found' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    ))
  }

  // Server-side heartbeat calls /api/chat through localhost and has no browser cookie.
  // Keep the bypass secret-only; never trust host/origin headers by themselves.
  const internalSecret = process.env.LUMBRE_INTERNAL_SECRET || process.env.LUMBRE_AUTH_SECRET || process.env.LUMBRE_ACCESS_PASSWORD
  if (pathname === '/api/chat' && internalSecret && request.headers.get('x-lumbre-internal') === internalSecret) {
    return securityHeaders(NextResponse.next())
  }

  if (!isAuthConfigured()) {
    if (pathname.startsWith('/api/')) {
      return securityHeaders(NextResponse.json(
        { error: 'Lumbre 公网鉴权尚未配置。请设置 LUMBRE_ACCESS_PASSWORD（至少 12 位）。' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      ))
    }
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('error', 'not_configured')
    return securityHeaders(NextResponse.redirect(loginUrl))
  }

  const valid = await verifySessionToken(request.cookies.get(authCookie.name)?.value)
  if (valid) return securityHeaders(NextResponse.next())

  if (pathname.startsWith('/api/')) {
    return securityHeaders(NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    ))
  }

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('next', `${pathname}${search}`)
  return securityHeaders(NextResponse.redirect(loginUrl))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
