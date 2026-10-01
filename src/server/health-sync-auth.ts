import { hasMatchingBearerSecret } from '@/server/bearer-auth'

export function isTrustedHealthSyncRequest(
  authorization: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return hasMatchingBearerSecret(authorization, String(env.LUMBRE_HEALTH_SYNC_SECRET || ''))
}
