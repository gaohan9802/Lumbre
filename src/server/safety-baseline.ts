const DEBUG_API_PREFIXES = ['/api/debug', '/api/memory/breath-debug']

/** Debug endpoints are useful locally, but must not exist in production. */
export function isDebugApiPath(pathname: string): boolean {
  return DEBUG_API_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export function shouldBlockDebugApi(pathname: string, nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv === 'production' && isDebugApiPath(pathname)
}

export function isTrustedInternalRequest(
  suppliedSecret: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = env.LUMBRE_INTERNAL_SECRET || env.LUMBRE_AUTH_SECRET || env.LUMBRE_ACCESS_PASSWORD || ''
  if (!expected || !suppliedSecret || expected.length !== suppliedSecret.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected.charCodeAt(i) ^ suppliedSecret.charCodeAt(i)
  return mismatch === 0
}
