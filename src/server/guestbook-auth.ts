import { safeEqual } from '@/lib/auth'

const SESSION_DAYS = 180

function password(): string {
  return process.env.LUMBRE_GUESTBOOK_PASSWORD?.trim() || ''
}

function secret(): string {
  return process.env.LUMBRE_GUESTBOOK_SECRET?.trim() || password()
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function signature(payload: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payload))))
}

export function isGuestbookConfigured(): boolean {
  return password().length >= 12
}

export function verifyGuestbookPassword(value: unknown): boolean {
  return typeof value === 'string' && isGuestbookConfigured() && safeEqual(value, password())
}

export async function createGuestbookSession(now = Date.now()): Promise<{ token: string; expires: Date }> {
  const expires = new Date(now + SESSION_DAYS * 24 * 60 * 60 * 1000)
  const nonce = base64Url(crypto.getRandomValues(new Uint8Array(18)))
  const payload = `${Math.floor(expires.getTime() / 1000)}.${nonce}`
  return { token: `${payload}.${await signature(payload)}`, expires }
}

export async function verifyGuestbookSession(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !isGuestbookConfigured()) return false
  const [expiryText, nonce, supplied, ...extra] = token.split('.')
  if (extra.length || !/^\d+$/.test(expiryText || '') || !/^[A-Za-z0-9_-]{20,}$/.test(nonce || '')) return false
  const expiry = Number(expiryText)
  if (!Number.isSafeInteger(expiry) || expiry * 1000 <= now) return false
  if (expiry * 1000 > now + (SESSION_DAYS + 1) * 24 * 60 * 60 * 1000) return false
  return safeEqual(supplied || '', await signature(`${expiryText}.${nonce}`))
}

export const guestbookCookie = {
  name: 'lumbre_guestbook',
  maxAge: SESSION_DAYS * 24 * 60 * 60,
}
