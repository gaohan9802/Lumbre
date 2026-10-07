import { hasMatchingBearerSecret } from '@/server/bearer-auth'

export function isTrustedCcToolBridgeRequest(
  authorization: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return hasMatchingBearerSecret(authorization, String(env.LUMBRE_CC_TOOL_BRIDGE_SECRET || ''))
}
