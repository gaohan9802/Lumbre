import fs from 'node:fs'
import { getDataDir } from '@/server/data/config'
import { readJsonFile, writeJsonFile } from '@/server/data/json-file'
import { resolveDataPath } from '@/server/data/safe-path'

export interface WeChatConnection {
  botToken: string
  accountId: string
  baseUrl: string
  userId: string
  targetSessionId: string
  connectedAt: string
  lastMessageAt?: string
  lastError?: string
}

const root = resolveDataPath(getDataDir(), 'wechat')
const connectionFile = resolveDataPath(root, 'connection.json')
const cursorFile = resolveDataPath(root, 'cursor.json')

export function readWeChatConnection(): WeChatConnection | null {
  try {
    const value = readJsonFile<WeChatConnection>(connectionFile)
    return value?.botToken && value?.accountId && value?.userId && value?.targetSessionId ? value : null
  } catch { return null }
}

export function writeWeChatConnection(value: WeChatConnection): void {
  writeJsonFile(connectionFile, value)
  try { fs.chmodSync(connectionFile, 0o600) } catch {}
}

export function patchWeChatConnection(patch: Partial<WeChatConnection>): WeChatConnection | null {
  const current = readWeChatConnection()
  if (!current) return null
  const next = { ...current, ...patch }
  writeWeChatConnection(next)
  return next
}

export function clearWeChatConnection(): void {
  for (const file of [connectionFile, `${connectionFile}.bak`, cursorFile, `${cursorFile}.bak`]) {
    try { fs.unlinkSync(file) } catch {}
  }
}

export function readWeChatCursor(): string {
  try { return String(readJsonFile<{ value?: string }>(cursorFile).value || '') } catch { return '' }
}

export function writeWeChatCursor(value: string): void {
  writeJsonFile(cursorFile, { value })
  try { fs.chmodSync(cursorFile, 0o600) } catch {}
}
