import { NextRequest, NextResponse } from 'next/server'
import { authCookie, isAuthConfigured, verifySessionToken } from './src/lib/auth'

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
