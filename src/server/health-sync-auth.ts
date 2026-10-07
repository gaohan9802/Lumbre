import { hasMatchingBearerSecret } from '@/server/bearer-auth'

export function isTrustedHealthSyncRequest(
  authorization: string | null,
  shortcutToken: string | null = null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = String(env.LUMBRE_HEALTH_SYNC_SECRET || '')
  return hasMatchingBearerSecret(authorization, expected)
    || hasMatchingBearerSecret(shortcutToken ? `Bearer ${shortcutToken}` : null, expected)
}
