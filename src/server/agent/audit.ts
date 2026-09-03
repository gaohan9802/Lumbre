import { appendToolAudit } from '@/server/data/log'
import type { ToolAuditEvent } from './types'

export function recordToolAudit(event: ToolAuditEvent): void {
  const line = JSON.stringify(event)
  if (!appendToolAudit(line)) console.error('[tool audit write failed]', line)
}
