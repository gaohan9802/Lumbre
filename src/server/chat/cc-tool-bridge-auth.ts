export function isTrustedCcToolBridgeRequest(
  authorization: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = String(env.LUMBRE_CC_TOOL_BRIDGE_SECRET || '')
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (expected.length < 32 || supplied.length !== expected.length) return false
  let mismatch = 0
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ supplied.charCodeAt(index)
  }
  return mismatch === 0
}
