import fs from 'node:fs'
import { getDataDir } from './config'
import { withFileLock } from './lock'
import { resolveDataPath } from './safe-path'

const CHAT_UPSTREAM_ERROR_LOG = resolveDataPath(getDataDir(), 'chat-upstream-errors.jsonl')
const CHAT_UPSTREAM_ERROR_BACKUP = resolveDataPath(getDataDir(), 'chat-upstream-errors.jsonl.1')
const TOOL_AUDIT_LOG = resolveDataPath(getDataDir(), 'tool-audit.jsonl')
const TOOL_AUDIT_BACKUP = resolveDataPath(getDataDir(), 'tool-audit.jsonl.1')

function appendBoundedLog(filePath: string, backupPath: string, line: string): boolean {
  try {
    withFileLock(filePath, () => {
      try {
        if (fs.statSync(filePath).size > 1024 * 1024) fs.renameSync(filePath, backupPath)
      } catch {}
      fs.appendFileSync(filePath, line.endsWith('\n') ? line : `${line}\n`, 'utf8')
    })
    return true
  } catch {
    return false
  }
}

/** Append one already-sanitized diagnostic line to a size-bounded durable log. */
export function appendChatUpstreamError(line: string): boolean {
  return appendBoundedLog(CHAT_UPSTREAM_ERROR_LOG, CHAT_UPSTREAM_ERROR_BACKUP, line)
}

/** Append one privacy-minimized tool permission/audit event. */
export function appendToolAudit(line: string): boolean {
  return appendBoundedLog(TOOL_AUDIT_LOG, TOOL_AUDIT_BACKUP, line)
}

export function readToolAudit(limit = 100): unknown[] {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)))
  try {
    return withFileLock(TOOL_AUDIT_LOG, () => {
      let raw = ''
      try { raw = fs.readFileSync(TOOL_AUDIT_LOG, 'utf8') } catch { return [] }
      return raw.split('\n').filter(Boolean).slice(-safeLimit).flatMap(line => {
        try { return [JSON.parse(line)] } catch { return [] }
      })
    })
  } catch {
    return []
  }
}
