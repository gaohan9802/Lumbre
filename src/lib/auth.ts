const COOKIE_NAME = 'lumbre_session'
const SESSION_DAYS = 30

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function hmac(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return bytesToBase64Url(new Uint8Array(signature))
}

export function getAuthPassword(): string {
  return process.env.LUMBRE_ACCESS_PASSWORD?.trim() || ''
}

function getSessionSecret(): string {
  return process.env.LUMBRE_AUTH_SECRET?.trim() || getAuthPassword()
}

export function isAuthConfigured(): boolean {
  return getAuthPassword().length >= 12
}

export function safeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  const length = Math.max(left.length, right.length, 1)
  let mismatch = left.length ^ right.length
  for (let i = 0; i < length; i += 1) mismatch |= (left[i] || 0) ^ (right[i] || 0)
  return mismatch === 0
}

export async function createSessionToken(now = Date.now()): Promise<{ token: string; expires: Date }> {
  const expires = new Date(now + SESSION_DAYS * 24 * 60 * 60 * 1000)
  const nonce = bytesToBase64Url(crypto.getRandomValues(new Uint8Array(18)))
  const payload = `${Math.floor(expires.getTime() / 1000)}.${nonce}`
  const signature = await hmac(payload, getSessionSecret())
  return { token: `${payload}.${signature}`, expires }
}

export async function verifySessionToken(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !isAuthConfigured()) return false
  const parts = token.split('.')
  if (parts.length !== 3) return false
  const [expiryText, nonce, suppliedSignature] = parts
  if (!/^\d+$/.test(expiryText) || !/^[A-Za-z0-9_-]{20,}$/.test(nonce)) return false
  const expiry = Number(expiryText)
  if (!Number.isSafeInteger(expiry) || expiry * 1000 <= now) return false
  // Reject tokens with an unreasonable lifetime even if correctly signed.
  if (expiry * 1000 > now + (SESSION_DAYS + 1) * 24 * 60 * 60 * 1000) return false
  const expectedSignature = await hmac(`${expiryText}.${nonce}`, getSessionSecret())
  return safeEqual(suppliedSignature, expectedSignature)
}

export const authCookie = {
  name: COOKIE_NAME,
  maxAge: SESSION_DAYS * 24 * 60 * 60,
}
