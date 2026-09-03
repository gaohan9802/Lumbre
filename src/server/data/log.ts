import fs from 'node:fs'
import { getDataDir } from './config'
import { withFileLock } from './lock'
import { resolveDataPath } from './safe-path'

const CHAT_UPSTREAM_ERROR_LOG = resolveDataPath(getDataDir(), 'chat-upstream-errors.jsonl')
const CHAT_UPSTREAM_ERROR_BACKUP = resolveDataPath(getDataDir(), 'chat-upstream-errors.jsonl.1')

/** Append one already-sanitized diagnostic line to a size-bounded durable log. */
export function appendChatUpstreamError(line: string): boolean {
  try {
    withFileLock(CHAT_UPSTREAM_ERROR_LOG, () => {
      try {
        if (fs.statSync(CHAT_UPSTREAM_ERROR_LOG).size > 1024 * 1024) {
          fs.renameSync(CHAT_UPSTREAM_ERROR_LOG, CHAT_UPSTREAM_ERROR_BACKUP)
        }
      } catch {}
      fs.appendFileSync(CHAT_UPSTREAM_ERROR_LOG, line, 'utf8')
    })
    return true
  } catch {
    return false
  }
}
