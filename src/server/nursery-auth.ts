import { hasMatchingBearerSecret } from '@/server/bearer-auth'

export function isTrustedNurseryEventRequest(
  authorization: string | null,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return hasMatchingBearerSecret(authorization, String(env.NURSERY_EVENT_TOKEN || ''))
}
